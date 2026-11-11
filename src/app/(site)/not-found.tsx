import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-3xl font-extrabold">We can&rsquo;t find that page</h1>
      <p className="mt-2 text-muted">
        The comic or episode may have moved, or it hasn&rsquo;t been published yet.
      </p>
      <Link href="/" className="btn btn-primary mt-6">
        Back to the comics
      </Link>
    </div>
  );
}
