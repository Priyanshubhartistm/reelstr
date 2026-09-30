// Reference Reelstr relay (NP-3): kind allowlist + NIP-13 PoW floor on Scene events.
// Stores events in a local Badger DB. Config via env:
//
//	PORT (3334)  DB_PATH (./data/relay)  POW_BITS (0 = off)  EXTRA_KINDS ("1,7")
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/fiatjaf/eventstore/badger"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip13"
)

// Reelstr kinds (keep in sync with packages/protocol/src/kinds.ts) plus what clients need around them.
var baseKinds = []int{
	0, 3, 10002, // profile, follows, relay list
	34236,                     // Scene (NIP-71 addressable short video)
	31810, 31811, 31812, 9810, // Story, Cut, Series, Payout
	30005,      // NIP-51 video set
	1984, 1985, // reports, labels
	9734, 9735, // zap request/receipt
	9321, 10019, // nutzap, nutzap info
	7375, 7376, 17375, // NIP-60 wallet
	5, // deletions
}

const sceneKind = 34236

func main() {
	port := env("PORT", "3334")
	dbPath := env("DB_PATH", "./data/relay")
	powBits, _ := strconv.Atoi(env("POW_BITS", "0"))

	allowed := map[int]bool{}
	for _, k := range baseKinds {
		allowed[k] = true
	}
	for _, s := range strings.Split(env("EXTRA_KINDS", ""), ",") {
		if k, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
			allowed[k] = true
		}
	}

	relay := khatru.NewRelay()
	relay.Info.Name = "reelstr-relay"
	relay.Info.Description = "Reelstr reference relay: kind allowlist and PoW floor"
	relay.Info.SupportedNIPs = []any{1, 9, 11, 13, 40}

	db := &badger.BadgerBackend{Path: dbPath}
	if err := db.Init(); err != nil {
		log.Fatalf("db: %v", err)
	}
	relay.StoreEvent = append(relay.StoreEvent, db.SaveEvent)
	relay.QueryEvents = append(relay.QueryEvents, db.QueryEvents)
	relay.DeleteEvent = append(relay.DeleteEvent, db.DeleteEvent)
	relay.ReplaceEvent = append(relay.ReplaceEvent, db.ReplaceEvent)

	relay.RejectEvent = append(relay.RejectEvent, func(ctx context.Context, ev *nostr.Event) (bool, string) {
		if !allowed[ev.Kind] {
			return true, fmt.Sprintf("blocked: kind %d is not a Reelstr kind", ev.Kind)
		}
		if powBits > 0 && ev.Kind == sceneKind {
			if err := nip13.Check(ev.ID, powBits); err != nil {
				return true, fmt.Sprintf("pow: scenes need %d bits of NIP-13 proof of work", powBits)
			}
		}
		return false, ""
	})

	log.Printf("reelstr-relay on :%s db=%s pow=%d kinds=%d", port, dbPath, powBits, len(allowed))
	log.Fatal(http.ListenAndServe(":"+port, relay))
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
