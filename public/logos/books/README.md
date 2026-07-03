# Sportsbook logos

Drop a square-ish logo file for each book here, named by its Odds API key
(matches `ALLOWED_BOOK_KEYS` in `src/lib/odds/bookAllowlist.ts`). `.svg` is
preferred; `.png` also works. Until a file exists, that book shows a colored
initials badge instead — nothing breaks either way.

| Book       | Filename                          |
|------------|------------------------------------|
| DraftKings | `draftkings.svg` (or `.png`)       |
| FanDuel    | `fanduel.svg`                      |
| BetMGM     | `betmgm.svg`                       |
| BetRivers  | `betrivers.svg`                    |
| ESPN BET   | `espnbet.svg`                      |

Caesars (`williamhill_us`) and Fanatics (`fanatics`) are deliberately not
listed — both are gated behind a paid Odds API plan and never populate on the
free tier, so they're excluded from `ALLOWED_BOOK_KEYS` entirely (see
`src/lib/odds/bookAllowlist.ts`). Add rows back here if that plan is ever
upgraded.
