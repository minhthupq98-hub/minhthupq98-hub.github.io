import type { Metadata } from "next";
import CustomerPage from "../customer-page";
export const metadata: Metadata = { title: "Tài khoản · THE KHE" };
export default function AccountPage() { return <CustomerPage initialPanel="overview"/>; }
