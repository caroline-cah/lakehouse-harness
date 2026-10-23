"""Run with: cd scripts/lakehouse && python3 -m unittest test_generate"""
import csv
import io
import json
import unittest
from datetime import date

from generate import Dataset, STORES, WEEK_43_UPLIFT_STORE, generate, expected_numbers, iso_week_bounds


class GenerateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds = generate(seed=42)

    def test_deterministic(self):
        a = generate(seed=42).to_csv()
        b = generate(seed=42).to_csv()
        self.assertEqual(a, b)

    def test_shapes(self):
        self.assertEqual(len(self.ds.stores), 8)
        self.assertEqual(len(self.ds.products), 50)
        self.assertEqual(len(self.ds.customers), 2000)
        self.assertEqual(len(self.ds.orders), 20000)

    def test_week_44_inside_range(self):
        self.assertGreaterEqual(max(o.order_ts for o in self.ds.orders)[:10], "2026-11-08")
        self.assertEqual(min(o.order_ts for o in self.ds.orders)[:10], "2026-07-01")

    def test_week_43_store_uplift(self):
        ex = expected_numbers(self.ds)
        w42 = ex["week_42"]["revenue_by_store"][WEEK_43_UPLIFT_STORE]
        w43 = ex["week_43"]["revenue_by_store"][WEEK_43_UPLIFT_STORE]
        self.assertGreaterEqual(w43, 1.25 * w42)

    def test_return_spike_product(self):
        ex = expected_numbers(self.ds)
        top = ex["week_43"]["top_return_rate_products"][0]
        self.assertEqual(top["name"], "Trail Runner 2")

    def test_pii_columns_last_in_customers(self):
        header = next(csv.reader(io.StringIO(self.ds.to_csv()["customers"])))
        self.assertEqual(header[-2:], ["email", "phone"])

    def test_iso_week_bounds(self):
        start, end = iso_week_bounds(2026, 43)
        self.assertEqual((start, end), (date(2026, 10, 19), date(2026, 10, 26)))


if __name__ == "__main__":
    unittest.main()
