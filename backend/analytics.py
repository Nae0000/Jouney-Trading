"""
Analytics Engine for Trading Journal.
Calculates key performance metrics from trade history.
"""

from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from models import Trade, Tag, EquitySnapshot, trade_tags
from sqlalchemy import func


def compute_analytics(trades: List[Trade]) -> Dict:
    """Compute comprehensive analytics from a list of closed trades."""
    if not trades:
        return _empty_analytics()

    # Filter to closed trades only
    closed = [t for t in trades if t.close_time is not None]
    if not closed:
        return _empty_analytics()

    wins = [t for t in closed if (t.profit + t.commission + t.swap) > 0]
    losses = [t for t in closed if (t.profit + t.commission + t.swap) <= 0]

    total_profit = sum(t.profit + t.commission + t.swap for t in wins)
    total_loss = abs(sum(t.profit + t.commission + t.swap for t in losses))

    avg_win = total_profit / len(wins) if wins else 0
    avg_loss = total_loss / len(losses) if losses else 0

    # Risk:Reward ratio
    avg_rr = round(avg_win / avg_loss, 2) if avg_loss > 0 else 0

    # Profit factor
    profit_factor = round(total_profit / total_loss, 2) if total_loss > 0 else float('inf')

    # Max consecutive wins/losses
    max_consec_wins, max_consec_losses = _max_consecutive(closed)

    # Best/worst trade
    all_pnl = [t.profit + t.commission + t.swap for t in closed]
    best_trade = max(all_pnl) if all_pnl else 0
    worst_trade = min(all_pnl) if all_pnl else 0

    # Max drawdown
    max_dd = _max_drawdown(closed)

    return {
        "total_trades": len(closed),
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "win_rate": round(len(wins) / len(closed) * 100, 1),
        "profit_factor": min(profit_factor, 999.99),
        "total_profit": round(total_profit, 2),
        "total_loss": round(total_loss, 2),
        "net_profit": round(total_profit - total_loss, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "avg_rr_ratio": avg_rr,
        "max_drawdown_pct": max_dd,
        "max_consecutive_wins": max_consec_wins,
        "max_consecutive_losses": max_consec_losses,
        "best_trade": round(best_trade, 2),
        "worst_trade": round(worst_trade, 2),
    }


def compute_strategy_performance(db: Session, account_id: int) -> List[Dict]:
    """Compute performance metrics grouped by strategy tag."""
    tags = db.query(Tag).all()
    results = []

    for tag in tags:
        tag_trades = (
            db.query(Trade)
            .filter(Trade.account_id == account_id)
            .filter(Trade.close_time.isnot(None))
            .filter(Trade.tags.any(Tag.id == tag.id))
            .all()
        )

        if not tag_trades:
            continue

        analytics = compute_analytics(tag_trades)
        results.append({
            "tag_name": tag.name,
            "total_trades": analytics["total_trades"],
            "win_rate": analytics["win_rate"],
            "profit_factor": analytics["profit_factor"],
            "net_profit": analytics["net_profit"],
            "avg_rr_ratio": analytics["avg_rr_ratio"],
        })

    return results


def compute_monthly_pnl(trades: List[Trade]) -> List[Dict]:
    """Compute monthly profit/loss breakdown."""
    closed = [t for t in trades if t.close_time is not None]
    monthly = {}

    for t in closed:
        key = t.close_time.strftime("%Y-%m")
        pnl = t.profit + t.commission + t.swap
        if key not in monthly:
            monthly[key] = {"month": key, "profit": 0, "loss": 0, "trades": 0}
        if pnl > 0:
            monthly[key]["profit"] += pnl
        else:
            monthly[key]["loss"] += pnl
        monthly[key]["trades"] += 1

    result = []
    for key in sorted(monthly.keys()):
        m = monthly[key]
        result.append({
            "month": m["month"],
            "profit": round(m["profit"], 2),
            "loss": round(m["loss"], 2),
            "net": round(m["profit"] + m["loss"], 2),
            "trades": m["trades"],
        })

    return result


def compute_symbol_performance(trades: List[Trade]) -> List[Dict]:
    """Compute performance per trading symbol."""
    closed = [t for t in trades if t.close_time is not None]
    symbols = {}

    for t in closed:
        if t.symbol not in symbols:
            symbols[t.symbol] = []
        symbols[t.symbol].append(t)

    results = []
    for symbol, sym_trades in sorted(symbols.items()):
        analytics = compute_analytics(sym_trades)
        results.append({
            "symbol": symbol,
            "total_trades": analytics["total_trades"],
            "win_rate": analytics["win_rate"],
            "net_profit": analytics["net_profit"],
            "profit_factor": analytics["profit_factor"],
        })

    return results


def compute_mae(trades: List[Trade]) -> List[Dict]:
    """
    Compute Maximum Adverse Excursion approximation.
    In practice, you'd need tick data. Here we approximate using
    open price vs stop_loss distance.
    """
    closed = [t for t in trades if t.close_time is not None and t.stop_loss]
    results = []

    for t in closed:
        if t.trade_type == "BUY":
            mae_pips = (t.open_price - t.stop_loss) if t.stop_loss else 0
        else:
            mae_pips = (t.stop_loss - t.open_price) if t.stop_loss else 0

        pnl = t.profit + t.commission + t.swap
        results.append({
            "ticket_id": t.ticket_id,
            "symbol": t.symbol,
            "pnl": round(pnl, 2),
            "mae_distance": round(abs(mae_pips), 5),
            "is_winner": pnl > 0,
        })

    return results


# ---------- Helper functions ----------

def _max_consecutive(trades: List[Trade]) -> tuple:
    """Calculate max consecutive wins and losses."""
    max_wins = max_losses = 0
    curr_wins = curr_losses = 0

    for t in sorted(trades, key=lambda x: x.close_time):
        pnl = t.profit + t.commission + t.swap
        if pnl > 0:
            curr_wins += 1
            curr_losses = 0
            max_wins = max(max_wins, curr_wins)
        else:
            curr_losses += 1
            curr_wins = 0
            max_losses = max(max_losses, curr_losses)

    return max_wins, max_losses


def _max_drawdown(trades: List[Trade]) -> float:
    """Calculate maximum drawdown percentage from sequential trades."""
    sorted_trades = sorted(trades, key=lambda x: x.close_time)
    if not sorted_trades:
        return 0

    # Build equity curve from trade sequence
    balance = 10000  # Starting balance assumption
    peak = balance
    max_dd = 0

    for t in sorted_trades:
        pnl = t.profit + t.commission + t.swap
        balance += pnl
        peak = max(peak, balance)
        dd = (peak - balance) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)

    return round(max_dd, 2)


def _empty_analytics() -> Dict:
    return {
        "total_trades": 0,
        "winning_trades": 0,
        "losing_trades": 0,
        "win_rate": 0,
        "profit_factor": 0,
        "total_profit": 0,
        "total_loss": 0,
        "net_profit": 0,
        "avg_win": 0,
        "avg_loss": 0,
        "avg_rr_ratio": 0,
        "max_drawdown_pct": 0,
        "max_consecutive_wins": 0,
        "max_consecutive_losses": 0,
        "best_trade": 0,
        "worst_trade": 0,
    }
