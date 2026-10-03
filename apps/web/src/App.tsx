import { LoginGate, UpdateNotice, useRoute, useSession } from "@reelstr/ui";
import { lazy, Suspense } from "react";
import { Landing } from "./Landing";

const Signed = lazy(() => import("./Signed"));

export function App() {
  const { client } = useSession();
  const [page] = useRoute();
  // the public page is for people who are not signed in yet; everything else asks for a key
  return (
    <>
      <UpdateNotice />
      {!client && (!page || page === "about") ? (
        <Landing />
      ) : (
        <LoginGate title="Sign in">
          <Suspense
            fallback={
              <p role="status" className="muted" style={{ padding: "2rem" }}>
                Loading…
              </p>
            }
          >
            <Signed />
          </Suspense>
        </LoginGate>
      )}
    </>
  );
}
