import { safeNextPath } from "@/lib/access";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Hindsight" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const next = (await searchParams).next;
  return (
    <div className="empty">
      <h1 className="title" style={{ marginBottom: 16 }}>
        Hindsight is private for now
      </h1>
      <p>
        This copy runs on a personal Riot API key, which Riot only allows for a small private
        group. Enter the password you were given. This browser will remember it for a year.
      </p>
      <LoginForm next={safeNextPath(typeof next === "string" ? next : null)} />
    </div>
  );
}
