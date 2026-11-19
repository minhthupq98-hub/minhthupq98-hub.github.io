import type { Metadata } from "next";
import CustomerPage from "../customer-page";
export const metadata: Metadata = { title: "Lịch sử đơn · THE KHE" };
export default function OrdersPage() { return <CustomerPage initialPanel="orders"/>; }
