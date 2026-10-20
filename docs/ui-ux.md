# UI and UX

The interface is a single page app with one gate in front of it: a password
screen. Behind the gate there are twelve routes, four item types, a bilingual
interface and a search overlay. This document covers the information
architecture, the interaction model, the visual system and the accessibility
baseline. Read it before changing a route, a form field or a token.

## 1. Information architecture

| Path | Component | Shows |
|---|---|---|
| `/` | `Dashboard` | type counts, tag filters, up to five favorites, six most recent items |
| `/items` | `AllItems` | every item, card or list |
| `/items/:id` | `ItemDetail` | one item, with the action row |
| `/links` | `Links` | items of type `link` |
| `/notes` | `Notes` | items of type `note` |
| `/snippets` | `Snippets` | items of type `snippet` |
| `/credentials` | `Credentials` | items of type `credential` |
| `/favorites` | `Favorites` | items where `is_favorite` is true |
| `/tags` | `Tags` | the tag index with counts |
| `/tags/:tag` | `Tags` | items carrying that tag |
| `/archive` | `Archive` | items where `is_archived` is true |
| `/settings` | `Settings` | appearance, account, about |

`AllItems`, the four type pages, `Favorites` and `Archive` all render the same
`ItemsView` component with a different filter function
(`src/components/ItemsView.tsx`).

The navigation has ten entries: Dashboard, All Items, Links, Notes, Snippets,
Credentials, Favorites, Tags, Archive, Settings. Item detail is not in the
navigation, it is reached from a card or a search result.

## 2. The auth gate

`src/App.tsx` has three states:

| State | Screen |
|---|---|
| `authed === null` | nothing renders, the session check is in flight |
| `authed === false` | `LoginScreen` |
| `authed === true` | the router |

`LoginScreen` is a single password field with `autoComplete="current-password"`
and autofocus. A failed attempt shows the wrong password message in a
`role="alert"` paragraph. The submit button is disabled while the request is
in flight or while the field is empty.

`useAuth` also listens for the `pv:logout` event, so a session that expires
anywhere in the app returns the user to this screen.

## 3. The shell

`src/layouts/AppLayout.tsx`:

- A skip to content link, visible only on focus, pointing at `#main-content`.
- A desktop sidebar, 256 pixels wide, hidden below the `md` breakpoint. It
  holds the app name, the navigation and the theme toggle.
- A mobile bottom navigation, fixed, horizontally scrollable, with the same
  ten entries.
- The search overlay, mounted with the full item list.
- The main column, centred, capped at a comfortable reading width.

Both navigation elements carry `aria-label="Primary"`.

## 4. Item types and the form

`ItemForm` renders the fields for the selected type:

| Type | Fields |
|---|---|
| `link` | title, url, description, notes |
| `note` | title, body |
| `snippet` | title, content, language |
| `credential` | title, website, username, password, notes |

Every form also has the tag input. When neither `initial` nor `type` is
given, a type selector appears at the top and defaults to `note`.

Validation while typing:

- the title is required, the form refuses to submit an empty one;
- a link URL must parse as a URL with an `http:` or `https:` protocol;
- tags are validated as they are added, with the rules in
  `src/lib/validators.ts`.

Form errors render in a `role="alert"` paragraph. The submit button reads
Create for a new item and Save for an edit.

## 5. Item lifecycle

| Action | Where | Behaviour |
|---|---|---|
| Create | `QuickAdd` on the dashboard and in `ItemsView` | opens a modal with the form |
| Edit | `ItemDetail` | switches the page into the form, then returns to the detail view |
| Delete | `ItemDetail` | two step: Delete first, then a Confirm button, then it navigates back |
| Favorite | `ItemDetail` | toggles `is_favorite`, the button carries `aria-pressed` |
| Archive | `ItemDetail` | toggles `is_archived` |
| Restore | `ItemDetail`, on an archived item | clears `is_archived` |
| Duplicate | `ItemDetail` | copies the item, appends " (copy)" to the title, creates a new id |

Duplicate resets `is_archived` to false and stamps fresh `created_at` and
`updated_at` values. Every action writes the whole item and then refetches the
list, so the view always matches the server.

`ItemDetail` shows the empty state with a Back action when the id in the URL
matches no item, for example after a delete on another device.

## 6. Search

The overlay opens with `Ctrl+K` or `Cmd+K` and closes with `Escape`
(`src/components/SearchOverlay.tsx`). It focuses the input when it opens.

The query parser is `src/lib/search.ts`. It splits the query into tokens and
supports:

| Syntax | Meaning |
|---|---|
| `type:link` | only items of that type |
| `tag:work` | only items carrying that tag, several tags must all match |
| `is:favorite` | only favorite items |
| `is:archived` | only archived items |
| `"two words"` | a quoted phrase is one token |
| anything else | free text |

Free text is matched case insensitively as a substring against the title, the
body, the content, the url, the description, the notes, the username and the
tag list. An empty query returns no results rather than every item.

The overlay shows a row of operator chips above the input. Note that the chips
advertise `created:`, `updated:` and `AND`, which the parser does not
implement. Those three are display only. Treat the parser as the spec.

A result is a button that navigates to `/items/:id`.

## 7. Tags

`useTags` derives the tag list from the items, counting how many items carry
each tag, sorted by count descending and then by name.

Tags appear in three places: the tag filter row on the dashboard, the same
row in `ItemsView` where a click filters the current view, and the tag index
at `/tags`. Clicking a tag on the dashboard filters the recent list, clicking
it in `ItemsView` filters that view, and `/tags/:tag` shows a dedicated page.

## 8. Settings

`src/pages/Settings.tsx` has three cards plus the service worker notice:

- **Appearance**: theme (`system`, `light`, `dark`) and language (`en`, `id`).
- **Account**: a logout button.
- **About**: the version string and the privacy note. The version comes from
  the `__APP_VERSION__` define in `vite.config.ts`, which is the package
  version plus the short git SHA.

## 9. Internationalization

`src/i18n/keys.ts` is the registry: 65 keys, each with an English and an
Indonesian string in `src/i18n/index.ts`. `t(key)` returns the string for the
current locale.

The chosen locale is stored in `localStorage["pv-locale"]`. When nothing is
stored, `src/main.tsx` falls back to the device locale, choosing `id` when
`navigator.language` starts with `id` and `en` otherwise. The document `lang`
attribute is set at startup. `index.html` ships `lang="id"`.

Adding a string means adding a key to the registry and both translations to
the dictionary. `tests/i18n.test.ts` checks that the two stay in step.

## 10. Theming

Three modes: `system`, `light`, `dark`. The choice is stored in
`localStorage["pv-theme"]` and applied by adding or removing the `light` and
`dark` class on the document element. `system` follows the
`prefers-color-scheme` media query. The theme is applied before the first
paint in `src/main.tsx`, so there is no flash.

`src/index.css` defines a Catppuccin style palette as `--ctp-*` custom
properties, plus semantic aliases on top of them:

| Alias | Maps to |
|---|---|
| `--color-canvas` | `--ctp-base` |
| `--color-card` | `--ctp-mantle` |
| `--color-text` | `--ctp-text` |
| `--color-muted` | `--ctp-subtext0` |
| `--color-border` | `--ctp-overlay0` |
| `--color-primary` | `--ctp-blue` |
| `--color-secondary` | `--ctp-mauve` |
| `--color-link` | `--ctp-lavender` |
| `--color-success` | `--ctp-green` |
| `--color-warning` | `--ctp-yellow` |
| `--color-error` | `--ctp-red` |
| `--color-info` | `--ctp-sky` |

Radius tokens run from `--radius-sm` (4 pixels) to `--radius-full`. The dark
theme overrides the `--ctp-*` values, the semantic aliases follow
automatically.

## 11. Accessibility

- Skip to content link, first in the tab order.
- Navigation landmarks on both the sidebar and the bottom bar, labelled
  `Primary`.
- The search overlay is a `role="dialog"` with `aria-modal="true"`, the input
  is a `role="combobox"`, the results are a `role="listbox"` with
  `role="option"` rows.
- Form errors use `role="alert"`, the service worker notice uses
  `role="status"`.
- Every form control has a `<label>` bound by `htmlFor` and `id`.
- The favorite button carries `aria-pressed`, the reveal button on a
  credential carries `aria-pressed` as well.
- Item cards are buttons with an `aria-label` of the form `type: title`.
- Focus styles use `focus-visible` so they appear for keyboard use.
- `tests/pwa/a11y-shell.test.tsx` renders the whole app behind a mocked
  session and asserts the landmark structure.

## 12. States

| State | Behaviour |
|---|---|
| Loading | `useItems` starts with `loading: true`; the list renders empty until the first fetch resolves |
| Empty | `EmptyState` with a title, an optional description and an optional action |
| Error | the item form shows the error message; a failed refresh keeps the previous list and logs a warning |
| Offline | the service worker serves the cached shell, and the API calls fail, so the list stays as it was |

## 13. Install prompt and update notice

`InstallPrompt` appears on the dashboard. On Chromium it shows a button that
replays the captured `beforeinstallprompt` event. On iOS it explains the
Share, Add to Home Screen path, because iOS has no install prompt event.

`UpdateNotice` sits at the top of the settings page and reads the service
worker state through `useSyncExternalStore`. With the default `auto` strategy
it shows a note that the app was updated and reloaded. With the `prompt`
strategy it shows an actionable notice instead.

## 14. Known gaps

- The search operator chips advertise `created:`, `updated:` and `AND`. The
  parser implements none of them.
- There is no export or import in the interface.
- The item list has no pagination and no virtualisation. It assumes a few
  hundred items.
- The tag filter on the dashboard and in `ItemsView` is local state, so it is
  not preserved when the route changes.
- The credential password is masked in the detail view but stored in clear.
- The type selector in the form is English only, it is not in the locale
  registry.

## Related documents

- [Architecture](architecture.md), the router and the auth gate in context.
- [Data Model](data-model.md), the item fields the form edits.
- [PWA Operations](pwa-operational.md), the install prompt and the update
  notice.
