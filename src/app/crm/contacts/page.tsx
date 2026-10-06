import { redirect } from "next/navigation";

// Contacts became the People master (one record per person, a journey per sender).
export default function ContactsPage() {
  redirect("/people");
}
