"""Synthetic retail lakehouse. Standard library only, deterministic for a seed.

Writes data/<table>/part-0.csv and golden/expected.json (exact numbers per ISO week).
PII columns (email, phone) are the LAST columns of customers.csv on purpose: the Glue table
declares only the columns before them, so Athena cannot read them (OpenCSVSerde maps by position).

Usage: python3 scripts/lakehouse/generate.py [--seed 42] [--out <repo root>]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

START = date(2026, 7, 1)
END = date(2026, 11, 8)  # inclusive
N_CUSTOMERS = 2000
N_PRODUCTS = 50
N_ORDERS = 20000
WEEK_43_UPLIFT_STORE = "Göteborg"
WEEK_43_UPLIFT = 0.30
RETURN_SPIKE_PRODUCT = "Trail Runner 2"
RETURN_SPIKE_WEEKS = (43, 44)

STORES = [
    ("S01", "Stockholm", "Stockholm", "East"),
    ("S02", "Göteborg", "Göteborg", "West"),
    ("S03", "Malmö", "Malmö", "South"),
    ("S04", "Uppsala", "Uppsala", "East"),
    ("S05", "Linköping", "Linköping", "East"),
    ("S06", "Örebro", "Örebro", "Central"),
    ("S07", "Västerås", "Västerås", "Central"),
    ("S08", "Umeå", "Umeå", "North"),
]
CATEGORIES = {
    "Footwear": ["Trail Runner 2", "City Sneaker", "Rain Boot", "Hiking Boot Pro", "Slip-on Loafer", "Court Shoe", "Sandal Breeze", "Winter Boot"],
    "Outerwear": ["Shell Jacket", "Down Parka", "Fleece Half-zip", "Rain Coat", "Wind Vest", "Wool Coat", "Puffer Jacket", "Softshell"],
    "Tops": ["Merino Base Layer", "Cotton Tee", "Flannel Shirt", "Hoodie Classic", "Polo Pique", "Linen Shirt", "Thermal Top", "Cardigan Knit"],
    "Bottoms": ["Hiking Pant", "Denim Straight", "Chino Slim", "Rain Trouser", "Jogger Fleece", "Shorts Trail", "Wool Trouser", "Cargo Pant"],
    "Accessories": ["Beanie Wool", "Scarf Merino", "Gloves Touch", "Cap Trail", "Belt Leather", "Socks 3-pack", "Backpack 20L", "Sunglasses Polar", "Water Bottle", "Headlamp"],
    "Equipment": ["Tent 2P", "Sleeping Bag -5", "Camp Stove", "Trekking Poles", "Dry Bag 10L", "Camp Chair", "Headtorch Mini", "First Aid Kit"],
}
BRANDS = ["Nordvind", "Fjällsten", "Kust", "Björk & Co", "Polaris Gear"]
FIRST = ["Anna", "Erik", "Maria", "Lars", "Karin", "Johan", "Eva", "Per", "Sara", "Anders", "Lena", "Mikael", "Elin", "Oskar", "Ida", "Nils", "Sofia", "Jonas", "Emma", "Daniel"]
LAST = ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson", "Pettersson", "Jonsson", "Jansson", "Hansson", "Bengtsson", "Lindberg", "Lindqvist", "Berg", "Holm", "Sandberg"]
CITIES = [s[2] for s in STORES] + ["Lund", "Norrköping", "Helsingborg", "Jönköping", "Gävle", "Sundsvall"]


@dataclass
class Store:
    store_id: str
    name: str
    city: str
    region: str


@dataclass
class Product:
    product_id: str
    name: str
    category: str
    brand: str
    list_price: float


@dataclass
class Customer:
    customer_id: str
    city: str
    signup_date: str
    email: str
    phone: str


@dataclass
class Order:
    order_id: str
    customer_id: str
    store_id: str
    order_ts: str
    status: str
    channel: str


@dataclass
class OrderLine:
    order_id: str
    line_no: int
    product_id: str
    qty: int
    unit_price: float
    discount: float


@dataclass
class Dataset:
    stores: list[Store]
    products: list[Product]
    customers: list[Customer]
    orders: list[Order]
    order_lines: list[OrderLine]

    def to_csv(self) -> dict[str, str]:
        out: dict[str, str] = {}
        tables = {
            "stores": (["store_id", "name", "city", "region"], self.stores),
            "products": (["product_id", "name", "category", "brand", "list_price"], self.products),
            # PII last, on purpose (see module docstring).
            "customers": (["customer_id", "city", "signup_date", "email", "phone"], self.customers),
            "orders": (["order_id", "customer_id", "store_id", "order_ts", "status", "channel"], self.orders),
            "order_lines": (["order_id", "line_no", "product_id", "qty", "unit_price", "discount"], self.order_lines),
        }
        for name, (header, rows) in tables.items():
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow(header)
            for r in rows:
                w.writerow([getattr(r, h) for h in header])
            out[name] = buf.getvalue()
        return out


def iso_week_bounds(year: int, week: int) -> tuple[date, date]:
    """Monday (inclusive) and next Monday (exclusive) of an ISO week."""
    monday = date.fromisocalendar(year, week, 1)
    return monday, monday + timedelta(days=7)


def _iso_week(ts: str) -> int:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).isocalendar().week


def generate(seed: int = 42) -> Dataset:
    rnd = random.Random(seed)
    stores = [Store(*s) for s in STORES]

    products: list[Product] = []
    i = 0
    for cat, names in CATEGORIES.items():
        for n in names:
            i += 1
            products.append(Product(f"P{i:03d}", n, cat, rnd.choice(BRANDS), round(rnd.uniform(99, 2499), 0)))
    products = products[:N_PRODUCTS]
    assert len(products) == N_PRODUCTS

    customers: list[Customer] = []
    for c in range(1, N_CUSTOMERS + 1):
        first, last = rnd.choice(FIRST), rnd.choice(LAST)
        signup = START - timedelta(days=rnd.randint(0, 900))
        customers.append(
            Customer(
                f"C{c:05d}",
                rnd.choice(CITIES),
                signup.isoformat(),
                f"{first.lower()}.{last.lower()}{c}@example.com",
                f"+46 70 {rnd.randint(100, 999)} {rnd.randint(10, 99)} {rnd.randint(10, 99)}",
            )
        )

    n_days = (END - START).days + 1
    orders: list[Order] = []
    lines: list[OrderLine] = []
    spike_product = next(p for p in products if p.name == RETURN_SPIKE_PRODUCT)
    uplift_store = next(s for s in stores if s.name == WEEK_43_UPLIFT_STORE)
    for o in range(1, N_ORDERS + 1):
        day = START + timedelta(days=rnd.randrange(n_days))
        ts = datetime(day.year, day.month, day.day, rnd.randint(7, 21), rnd.randint(0, 59), rnd.randint(0, 59), tzinfo=timezone.utc)
        ts_s = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        week = ts.isocalendar().week
        store = rnd.choice(stores)
        # Story fact 1: Göteborg is up ~30 % in week 43 — more of that week's orders land there.
        if week == 43 and rnd.random() < 0.065:  # lifts Göteborg’s share from 12.5 % to ~17 %, i.e. ~+30 %
            store = uplift_store
        customer = rnd.choice(customers)
        r = rnd.random()
        status = "returned" if r < 0.06 else "cancelled" if r < 0.08 else "placed"
        channel = "web" if rnd.random() < 0.55 else "store"
        order_id = f"O{o:06d}"
        n_lines = rnd.randint(1, 5)
        chosen = rnd.sample(products, n_lines)
        # Story fact 2: Trail Runner 2 has a return spike in weeks 43–44.
        if week in RETURN_SPIKE_WEEKS and rnd.random() < 0.15:
            chosen[0] = spike_product
            if rnd.random() < 0.6:
                status = "returned"
        orders.append(Order(order_id, customer.customer_id, store.store_id, ts_s, status, channel))
        for ln, p in enumerate(chosen, start=1):
            qty = rnd.randint(1, 3)
            price = p.list_price
            discount = round(price * qty * rnd.choice([0, 0, 0, 0.1, 0.2]), 2)
            lines.append(OrderLine(order_id, ln, p.product_id, qty, price, discount))
    orders.sort(key=lambda x: x.order_ts)
    return Dataset(stores, products, customers, orders, lines)


def expected_numbers(ds: Dataset) -> dict:
    """Exact answers per ISO week, computed the same way the metric definitions say."""
    by_order = {o.order_id: o for o in ds.orders}
    store_name = {s.store_id: s.name for s in ds.stores}
    product = {p.product_id: p for p in ds.products}
    weeks = sorted({_iso_week(o.order_ts) for o in ds.orders})
    out: dict = {}
    for wk in weeks:
        week_orders = [o for o in ds.orders if _iso_week(o.order_ts) == wk]
        ids = {o.order_id for o in week_orders}
        rev_store: dict[str, float] = {}
        rev_total = 0.0
        prod_orders: dict[str, set] = {}
        prod_returned: dict[str, set] = {}
        for l in ds.order_lines:
            if l.order_id not in ids:
                continue
            o = by_order[l.order_id]
            if o.status != "cancelled":
                amt = l.qty * l.unit_price - l.discount
                rev_store[store_name[o.store_id]] = rev_store.get(store_name[o.store_id], 0.0) + amt
                rev_total += amt
                prod_orders.setdefault(l.product_id, set()).add(o.order_id)
                if o.status == "returned":
                    prod_returned.setdefault(l.product_id, set()).add(o.order_id)
        n_orders = sum(1 for o in week_orders if o.status != "cancelled")
        n_returned = sum(1 for o in week_orders if o.status == "returned")
        rates = [
            {"product_id": pid, "name": product[pid].name, "orders": len(ords), "returned": len(prod_returned.get(pid, set())), "return_rate": round(len(prod_returned.get(pid, set())) / len(ords), 4)}
            for pid, ords in prod_orders.items()
            if len(ords) >= 10
        ]
        rates.sort(key=lambda r: (-r["return_rate"], r["name"]))
        start, end = iso_week_bounds(2026, wk)
        out[f"week_{wk}"] = {
            "from": start.isoformat(),
            "to_exclusive": end.isoformat(),
            "orders": n_orders,
            "returned_orders": n_returned,
            "return_rate": round(n_returned / n_orders, 4) if n_orders else 0,
            "revenue": round(rev_total, 2),
            "average_order_value": round(rev_total / n_orders, 2) if n_orders else 0,
            "revenue_by_store": {k: round(v, 2) for k, v in sorted(rev_store.items(), key=lambda kv: -kv[1])},
            "top_return_rate_products": rates[:5],
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", ".."))
    args = ap.parse_args()
    ds = generate(args.seed)
    for name, content in ds.to_csv().items():
        d = os.path.join(args.out, "data", name)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "part-0.csv"), "w", encoding="utf-8", newline="") as f:
            f.write(content)
    gd = os.path.join(args.out, "golden")
    os.makedirs(gd, exist_ok=True)
    with open(os.path.join(gd, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(expected_numbers(ds), f, indent=2, ensure_ascii=False)
    print(f"wrote {N_ORDERS} orders, {len(ds.order_lines)} lines, expected.json for weeks {list(expected_numbers(ds))[0]}..{list(expected_numbers(ds))[-1]}")


if __name__ == "__main__":
    main()
