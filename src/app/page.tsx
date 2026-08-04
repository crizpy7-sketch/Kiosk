import { redirect } from "next/navigation";

/** The kiosk is the product; the root is just a doorway to it. */
export default function RootPage() {
  redirect("/kiosk");
}
