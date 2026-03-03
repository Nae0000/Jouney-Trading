"""
Trading Journal API — FastAPI Application
"""

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from database import get_db, init_db
from models import Account, Trade, Tag, EquitySnapshot, trade_tags
from schemas import (
    AccountCreate, AccountOut, TagCreate, TagOut,
    TradeOut, JournalUpdate, EquitySnapshotOut,
    AnalyticsSummary, StrategyPerformance, SyncStatus,
)
from analytics import (
    compute_analytics, compute_strategy_performance,
    compute_monthly_pnl, compute_symbol_performance, compute_mae,
)
from mt5_service import sync_trades, seed_mock_data

app = FastAPI(title="Trading Journal API", version="1.0.0")

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


# ================================================================
# ACCOUNTS
# ================================================================

@app.get("/api/accounts", response_model=List[AccountOut])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(Account).all()


@app.post("/api/accounts", response_model=AccountOut)
def create_account(data: AccountCreate, db: Session = Depends(get_db)):
    existing = db.query(Account).filter(Account.mt5_login == data.mt5_login).first()
    if existing:
        raise HTTPException(400, "Account already exists")
    account = Account(
        mt5_login=data.mt5_login,
        server=data.server,
        name=data.name,
        password_hash=data.password,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


# ================================================================
# SYNC (MT5 → DB)
# ================================================================

@app.post("/api/accounts/{account_id}/sync", response_model=SyncStatus)
def trigger_sync(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(404, "Account not found")
    result = sync_trades(db, account)
    return result


@app.post("/api/seed-mock-data")
def seed_mock(db: Session = Depends(get_db)):
    """Seed database with mock data for demo purposes."""
    result = seed_mock_data(db)
    return result


# ================================================================
# TRADES
# ================================================================

@app.get("/api/accounts/{account_id}/trades", response_model=List[TradeOut])
def list_trades(
    account_id: int,
    status: Optional[str] = Query(None, description="open|closed|all"),
    symbol: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Trade).filter(Trade.account_id == account_id)

    if status == "open":
        q = q.filter(Trade.close_time.is_(None))
    elif status == "closed":
        q = q.filter(Trade.close_time.isnot(None))

    if symbol:
        q = q.filter(Trade.symbol == symbol.upper())

    if tag:
        q = q.filter(Trade.tags.any(Tag.name == tag))

    q = q.order_by(Trade.open_time.desc())
    return q.offset(offset).limit(limit).all()


@app.get("/api/trades/{trade_id}", response_model=TradeOut)
def get_trade(trade_id: int, db: Session = Depends(get_db)):
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(404, "Trade not found")
    return trade


@app.patch("/api/trades/{trade_id}/journal", response_model=TradeOut)
def update_journal(trade_id: int, data: JournalUpdate, db: Session = Depends(get_db)):
    """Update journal fields for a trade."""
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(404, "Trade not found")

    if data.entry_rationale is not None:
        trade.entry_rationale = data.entry_rationale
    if data.emotion is not None:
        trade.emotion = data.emotion
    if data.lesson is not None:
        trade.lesson = data.lesson
    if data.rating is not None:
        trade.rating = data.rating
    if data.screenshot_before is not None:
        trade.screenshot_before = data.screenshot_before
    if data.screenshot_after is not None:
        trade.screenshot_after = data.screenshot_after
    if data.tag_ids is not None:
        tags = db.query(Tag).filter(Tag.id.in_(data.tag_ids)).all()
        trade.tags = tags

    db.commit()
    db.refresh(trade)
    return trade


# ================================================================
# TAGS
# ================================================================

@app.get("/api/tags", response_model=List[TagOut])
def list_tags(db: Session = Depends(get_db)):
    return db.query(Tag).all()


@app.post("/api/tags", response_model=TagOut)
def create_tag(data: TagCreate, db: Session = Depends(get_db)):
    existing = db.query(Tag).filter(Tag.name == data.name).first()
    if existing:
        return existing
    tag = Tag(name=data.name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


# ================================================================
# ANALYTICS
# ================================================================

@app.get("/api/accounts/{account_id}/analytics/summary", response_model=AnalyticsSummary)
def get_analytics_summary(account_id: int, db: Session = Depends(get_db)):
    trades = (
        db.query(Trade)
        .filter(Trade.account_id == account_id)
        .filter(Trade.close_time.isnot(None))
        .all()
    )
    return compute_analytics(trades)


@app.get("/api/accounts/{account_id}/analytics/strategies", response_model=List[StrategyPerformance])
def get_strategy_performance(account_id: int, db: Session = Depends(get_db)):
    return compute_strategy_performance(db, account_id)


@app.get("/api/accounts/{account_id}/analytics/monthly")
def get_monthly_pnl(account_id: int, db: Session = Depends(get_db)):
    trades = db.query(Trade).filter(Trade.account_id == account_id).all()
    return compute_monthly_pnl(trades)


@app.get("/api/accounts/{account_id}/analytics/symbols")
def get_symbol_performance(account_id: int, db: Session = Depends(get_db)):
    trades = db.query(Trade).filter(Trade.account_id == account_id).all()
    return compute_symbol_performance(trades)


@app.get("/api/accounts/{account_id}/analytics/mae")
def get_mae(account_id: int, db: Session = Depends(get_db)):
    trades = db.query(Trade).filter(Trade.account_id == account_id).all()
    return compute_mae(trades)


# ================================================================
# EQUITY
# ================================================================

@app.get("/api/accounts/{account_id}/equity", response_model=List[EquitySnapshotOut])
def get_equity_curve(account_id: int, db: Session = Depends(get_db)):
    return (
        db.query(EquitySnapshot)
        .filter(EquitySnapshot.account_id == account_id)
        .order_by(EquitySnapshot.timestamp.asc())
        .all()
    )
