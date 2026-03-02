"""
Pydantic schemas for API request/response validation.
"""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ---------- Account ----------
class AccountCreate(BaseModel):
    mt5_login: int
    server: str
    name: str = ""
    password: str = ""


class AccountOut(BaseModel):
    id: int
    mt5_login: int
    server: str
    name: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------- Tag ----------
class TagCreate(BaseModel):
    name: str


class TagOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


# ---------- Trade ----------
class TradeOut(BaseModel):
    id: int
    account_id: int
    ticket_id: int
    order_id: Optional[int] = None
    symbol: str
    trade_type: str
    volume: float
    open_price: float
    close_price: Optional[float] = None
    open_time: datetime
    close_time: Optional[datetime] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    commission: float = 0
    swap: float = 0
    profit: float = 0
    floating_pl: float = 0
    # Journal
    entry_rationale: str = ""
    emotion: str = ""
    lesson: str = ""
    rating: Optional[int] = None
    screenshot_before: str = ""
    screenshot_after: str = ""
    tags: List[TagOut] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JournalUpdate(BaseModel):
    """Partial update for journal fields only."""
    entry_rationale: Optional[str] = None
    emotion: Optional[str] = None
    lesson: Optional[str] = None
    rating: Optional[int] = None
    screenshot_before: Optional[str] = None
    screenshot_after: Optional[str] = None
    tag_ids: Optional[List[int]] = None


# ---------- Equity Snapshot ----------
class EquitySnapshotOut(BaseModel):
    id: int
    account_id: int
    timestamp: Optional[datetime] = None
    balance: float
    equity: float
    margin: float = 0

    class Config:
        from_attributes = True


# ---------- Analytics ----------
class AnalyticsSummary(BaseModel):
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    profit_factor: float
    total_profit: float
    total_loss: float
    net_profit: float
    avg_win: float
    avg_loss: float
    avg_rr_ratio: float
    max_drawdown_pct: float
    max_consecutive_wins: int
    max_consecutive_losses: int
    best_trade: float
    worst_trade: float


class StrategyPerformance(BaseModel):
    tag_name: str
    total_trades: int
    win_rate: float
    profit_factor: float
    net_profit: float
    avg_rr_ratio: float


class SyncStatus(BaseModel):
    success: bool
    trades_synced: int
    open_positions: int
    message: str
