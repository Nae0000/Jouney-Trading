"""
SQLAlchemy ORM models for the Trading Journal.
Combines raw MT5 deal data with custom journal fields.
"""

from sqlalchemy import (
    Column, Integer, BigInteger, String, Float, Text, SmallInteger,
    DateTime, ForeignKey, Table, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

# ---------- Many-to-Many join table ----------
trade_tags = Table(
    "trade_tags",
    Base.metadata,
    Column("trade_id", Integer, ForeignKey("trades.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    mt5_login = Column(BigInteger, unique=True, nullable=False)
    server = Column(String(100), nullable=False)
    name = Column(String(100), default="")
    password_hash = Column(String(256), default="")  # stored encrypted
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    trades = relationship("Trade", back_populates="account", cascade="all, delete-orphan")
    equity_snapshots = relationship("EquitySnapshot", back_populates="account", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Account {self.mt5_login}@{self.server}>"


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    ticket_id = Column(BigInteger, unique=True, nullable=False, index=True)
    order_id = Column(BigInteger, nullable=True)
    symbol = Column(String(20), nullable=False)
    trade_type = Column(String(10), nullable=False)  # BUY / SELL
    volume = Column(Float, nullable=False)
    open_price = Column(Float, nullable=False)
    close_price = Column(Float, nullable=True)
    open_time = Column(DateTime(timezone=True), nullable=False)
    close_time = Column(DateTime(timezone=True), nullable=True)
    stop_loss = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)
    commission = Column(Float, default=0)
    swap = Column(Float, default=0)
    profit = Column(Float, default=0)
    floating_pl = Column(Float, default=0)

    # ------ Custom Journal Fields ------
    entry_rationale = Column(Text, default="")
    emotion = Column(String(30), default="")
    lesson = Column(Text, default="")
    rating = Column(SmallInteger, nullable=True)
    screenshot_before = Column(Text, default="")
    screenshot_after = Column(Text, default="")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    account = relationship("Account", back_populates="trades")
    tags = relationship("Tag", secondary=trade_tags, back_populates="trades")

    def __repr__(self):
        return f"<Trade #{self.ticket_id} {self.symbol} {self.trade_type}>"


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)

    trades = relationship("Trade", secondary=trade_tags, back_populates="tags")

    def __repr__(self):
        return f"<Tag {self.name}>"


class EquitySnapshot(Base):
    __tablename__ = "equity_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    balance = Column(Float, nullable=False)
    equity = Column(Float, nullable=False)
    margin = Column(Float, default=0)

    account = relationship("Account", back_populates="equity_snapshots")

    def __repr__(self):
        return f"<EquitySnapshot {self.timestamp} bal={self.balance}>"
