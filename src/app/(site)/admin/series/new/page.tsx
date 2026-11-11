import type { Metadata } from "next";
import { SeriesForm } from "@/components/admin/SeriesForm";
import { Banner } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New series" };

export default async function NewSeries({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-3xl font-extrabold">New series</h1>
      <Banner error={error} />
      <SeriesForm />
    </>
  );
}
