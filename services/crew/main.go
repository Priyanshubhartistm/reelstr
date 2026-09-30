// Reelstr crew relay (NP-4): a NIP-29 relay for closed production rooms. Drafts live here until a
// member releases them; nothing written here is served by any public relay.
//
//	PORT (3335)  DB_PATH (./data/crew)  DOMAIN (localhost)  RELAY_SECRET (hex; generated if empty)
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru/policies"
	"github.com/fiatjaf/relay29"
	"github.com/fiatjaf/relay29/khatru29"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip29"
)

var (
	admin  = &nip29.Role{Name: "admin", Description: "runs the room: invites, removes, deletes"}
	member = &nip29.Role{Name: "member", Description: "crew: writes drafts and chat"}
)

func main() {
	port := env("PORT", "3335")
	secret := env("RELAY_SECRET", nostr.GeneratePrivateKey())
	db := &badger.BadgerBackend{Path: env("DB_PATH", "./data/crew")}
	if err := db.Init(); err != nil {
		log.Fatalf("db: %v", err)
	}

	relay, state := khatru29.Init(relay29.Options{
		Domain:                  env("DOMAIN", "localhost"),
		DB:                      db,
		SecretKey:               secret,
		DefaultRoles:            []*nip29.Role{admin, member},
		GroupCreatorDefaultRole: admin,
	})

	state.AllowAction = func(ctx context.Context, group nip29.Group, role *nip29.Role, action relay29.Action) bool {
		switch action.(type) {
		case relay29.PutUser, relay29.RemoveUser, relay29.DeleteEvent, relay29.EditMetadata:
			return role == admin
		}
		return role == admin
	}

	relay.Info.Name = "reelstr-crew"
	relay.Info.Description = "Closed NIP-29 rooms for drafting Reelstr scenes before release"
	relay.RejectEvent = append(relay.RejectEvent,
		policies.PreventLargeTags(512),
		policies.RestrictToSpecifiedKinds(
			9, 11, 12, 1111, // chat and threads
			34236,                                          // draft Scene (NIP-71 addressable short video)
			9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, // moderation
			9021, 9022, // join and leave requests
		),
		policies.PreventTimestampsInTheFuture(60*time.Second),
	)

	log.Printf("reelstr-crew on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, relay))
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
