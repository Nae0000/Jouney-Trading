"""
MT5 Data Extraction Service.
Handles connection to MetaTrader 5 and syncing trade history to the database.
Falls back to mock data when MT5 is not available (for development/demo).
"""

import os
import sys
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from models import Account, Trade, EquitySnapshot

# Try to import MetaTrader5 — it only works on Windows with MT5 installed
MT5_AVAILABLE = False
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    pass


def connect_mt5(login: int, password: str, server: str) -> bool:
    """Initialize MT5 terminal and login."""
    if not MT5_AVAILABLE:
        print("[MT5] MetaTrader5 library not available — using mock mode")
        return False

    if not mt5.initialize():
        print(f"[MT5] initialize() failed: {mt5.last_error()}")
        return False

    authorized = mt5.login(login, password=password, server=server)
    if not authorized:
        print(f"[MT5] login failed: {mt5.last_error()}")
        mt5.shutdown()
        return False

    print(f"[MT5] Connected to {server} as {login}")
    return True


def disconnect_mt5():
    """Shutdown MT5 connection."""
    if MT5_AVAILABLE:
        mt5.shutdown()


def fetch_closed_deals(days_back: int = 90) -> List[Dict]:
    """Fetch closed deal history from MT5."""
    if not MT5_AVAILABLE:
        return []

    from_date = datetime.now() - timedelta(days=days_back)
    deals = mt5.history_deals_get(from_date, datetime.now())

    if deals is None:
        print(f"[MT5] No deals found: {mt5.last_error()}")
        return []

    results = []
    for d in deals:
        # Skip balance/credit operations, only include actual trades
        if d.type > 1:
            continue
        results.append({
            "ticket": d.ticket,
            "order": d.order,
            "symbol": d.symbol,
            "type": "BUY" if d.type == 0 else "SELL",
            "volume": d.volume,
            "price": d.price,
            "profit": d.profit,
            "commission": d.commission,
            "swap": d.swap,
            "time": datetime.fromtimestamp(d.time),
            "time_msc": d.time_msc,
        })

    return results


def fetch_open_positions() -> List[Dict]:
    """Fetch currently open positions from MT5."""
    if not MT5_AVAILABLE:
        return []

    positions = mt5.positions_get()
    if positions is None:
        return []

    return [
        {
            "ticket": p.ticket,
            "symbol": p.symbol,
            "type": "BUY" if p.type == 0 else "SELL",
            "volume": p.volume,
            "price_open": p.price_open,
            "price_current": p.price_current,
            "sl": p.sl,
            "tp": p.tp,
            "profit": p.profit,
            "swap": p.swap,
            "time": datetime.fromtimestamp(p.time),
        }
        for p in positions
    ]


def fetch_account_info() -> Optional[Dict]:
    """Fetch account balance/equity info from MT5."""
    if not MT5_AVAILABLE:
        return None

    info = mt5.account_info()
    if info is None:
        return None

    return {
        "balance": info.balance,
        "equity": info.equity,
        "margin": info.margin,
        "free_margin": info.margin_free,
    }


def sync_trades(db: Session, account: Account, days_back: int = 90) -> Dict:
    """
    Sync MT5 deals to the database.
    Uses ticket_id as the dedup key — existing trades are updated, new ones inserted.
    Returns sync summary.
    """
    connected = connect_mt5(
        login=account.mt5_login,
        password=account.password_hash,  # In production, decrypt first
        server=account.server,
    )

    if not connected:
        return {"success": False, "trades_synced": 0, "open_positions": 0,
                "message": "Could not connect to MT5"}

    try:
        # --- Sync closed deals ---
        deals = fetch_closed_deals(days_back)
        synced = 0
        for deal in deals:
            existing = db.query(Trade).filter(Trade.ticket_id == deal["ticket"]).first()
            if existing:
                # Update profit/swap in case they changed
                existing.profit = deal["profit"]
                existing.swap = deal["swap"]
                existing.commission = deal["commission"]
            else:
                trade = Trade(
                    account_id=account.id,
                    ticket_id=deal["ticket"],
                    order_id=deal["order"],
                    symbol=deal["symbol"],
                    trade_type=deal["type"],
                    volume=deal["volume"],
                    open_price=deal["price"],
                    close_price=deal["price"],  # For deals, price is the execution price
                    open_time=deal["time"],
                    close_time=deal["time"],
                    commission=deal["commission"],
                    swap=deal["swap"],
                    profit=deal["profit"],
                )
                db.add(trade)
                synced += 1

        # --- Sync open positions ---
        positions = fetch_open_positions()
        for pos in positions:
            existing = db.query(Trade).filter(Trade.ticket_id == pos["ticket"]).first()
            if existing:
                existing.floating_pl = pos["profit"]
                existing.close_price = pos["price_current"]
            else:
                trade = Trade(
                    account_id=account.id,
                    ticket_id=pos["ticket"],
                    symbol=pos["symbol"],
                    trade_type=pos["type"],
                    volume=pos["volume"],
                    open_price=pos["price_open"],
                    close_price=None,
                    open_time=pos["time"],
                    close_time=None,
                    stop_loss=pos["sl"],
                    take_profit=pos["tp"],
                    floating_pl=pos["profit"],
                    swap=pos["swap"],
                )
                db.add(trade)
                synced += 1

        # --- Snapshot equity ---
        acct_info = fetch_account_info()
        if acct_info:
            snapshot = EquitySnapshot(
                account_id=account.id,
                balance=acct_info["balance"],
                equity=acct_info["equity"],
                margin=acct_info["margin"],
            )
            db.add(snapshot)

        db.commit()

        return {
            "success": True,
            "trades_synced": synced,
            "open_positions": len(positions),
            "message": f"Synced {synced} new trades, {len(positions)} open positions",
        }

    finally:
        disconnect_mt5()


# ============================================================
# MOCK DATA — used when MT5 is not available (dev / demo mode)
# ============================================================
import random

def generate_mock_trades(account_id: int, count: int = 50) -> List[Dict]:
    """Generate realistic mock trade data for demo purposes."""
    symbols = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "GBPJPY", "AUDUSD", "EURJPY"]
    emotions = ["Confident", "Neutral", "Anxious", "FOMO", "Disciplined", "Greedy", "Patient"]
    strategies = ["Breakout", "SMC", "Trend Following", "Range Trading", "Scalping", "News Trading"]

    trades = []
    base_time = datetime.now() - timedelta(days=90)
    cumulative_balance = 10000.0

    for i in range(count):
        symbol = random.choice(symbols)
        trade_type = random.choice(["BUY", "SELL"])
        volume = round(random.choice([0.01, 0.02, 0.05, 0.1, 0.2, 0.5]), 2)

        # Generate realistic prices based on symbol
        if symbol == "XAUUSD":
            open_price = round(random.uniform(1900, 2100), 2)
            pip_value = 0.01
        elif "JPY" in symbol:
            open_price = round(random.uniform(130, 195), 3)
            pip_value = 0.001
        else:
            open_price = round(random.uniform(1.0, 1.4), 5)
            pip_value = 0.00001

        # Win/loss with ~55% win rate
        is_winner = random.random() < 0.55
        pips = random.uniform(5, 80) if is_winner else -random.uniform(5, 60)
        close_price = round(open_price + (pips * pip_value * (1 if trade_type == "BUY" else -1)), 5)
        profit = round(pips * volume * (10 if "JPY" in symbol or symbol == "XAUUSD" else 10), 2)
        commission = round(-volume * 3.5 * 2, 2)
        swap = round(random.uniform(-2, 1), 2)

        open_time = base_time + timedelta(hours=random.randint(1, 24 * 90))
        duration_hours = random.uniform(0.1, 72)
        close_time = open_time + timedelta(hours=duration_hours)

        sl_dist = random.uniform(10, 50) * pip_value
        tp_dist = random.uniform(15, 100) * pip_value

        cumulative_balance += profit + commission + swap

        trades.append({
            "account_id": account_id,
            "ticket_id": 100000 + i,
            "order_id": 200000 + i,
            "symbol": symbol,
            "trade_type": trade_type,
            "volume": volume,
            "open_price": open_price,
            "close_price": close_price,
            "open_time": open_time,
            "close_time": close_time,
            "stop_loss": round(open_price - sl_dist if trade_type == "BUY" else open_price + sl_dist, 5),
            "take_profit": round(open_price + tp_dist if trade_type == "BUY" else open_price - tp_dist, 5),
            "commission": commission,
            "swap": swap,
            "profit": profit,
            "floating_pl": 0,
            "_emotion": random.choice(emotions),
            "_strategy": random.choice(strategies),
            "_balance": round(cumulative_balance, 2),
        })

    # Sort by open_time
    trades.sort(key=lambda t: t["open_time"])
    return trades


def seed_mock_data(db: Session):
    """Seed mock data into the database for demo/development."""
    # Check if already seeded
    existing = db.query(Account).first()
    if existing:
        return {"message": "Data already seeded", "account_id": existing.id}

    # Create demo account
    account = Account(
        mt5_login=12345678,
        server="Demo-Server",
        name="Demo Account",
    )
    db.add(account)
    db.flush()

    # Generate and insert mock trades
    mock_trades = generate_mock_trades(account.id, count=60)

    # Create some tags
    from models import Tag, trade_tags
    tag_names = ["Breakout", "SMC", "Trend Following", "Range Trading", "Scalping", "News Trading"]
    tags = {}
    for name in tag_names:
        tag = Tag(name=name)
        db.add(tag)
        db.flush()
        tags[name] = tag

    for t in mock_trades:
        emotion = t.pop("_emotion")
        strategy = t.pop("_strategy")
        balance = t.pop("_balance")

        trade = Trade(**t)
        # Assign a random journal entry to ~40% of trades
        if random.random() < 0.4:
            trade.entry_rationale = f"Saw a clear {strategy} setup on the {t['symbol']} 1H chart."
            trade.emotion = emotion
            trade.lesson = "Followed my plan." if t["profit"] > 0 else "Need to be more patient."
            trade.rating = random.randint(2, 5)

        # Tag the trade
        if strategy in tags:
            trade.tags.append(tags[strategy])

        db.add(trade)

        # Create equity snapshot
        snapshot = EquitySnapshot(
            account_id=account.id,
            timestamp=t["close_time"],
            balance=balance,
            equity=balance + random.uniform(-50, 50),
            margin=random.uniform(50, 500),
        )
        db.add(snapshot)

    db.commit()
    return {"message": f"Seeded {len(mock_trades)} trades", "account_id": account.id}
