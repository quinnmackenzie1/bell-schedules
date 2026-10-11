# Bell Schedules

Bell schedule data plus everything that reads it: a Chrome extension, a web
clock, an editor, and a one-tap console for the front office.

## Who edits what

| I want to… | Use | Who |
|---|---|---|
| Change a time, add a school, build next year | `schedule-editor.html` | schedule owner |
| Apply a snow day or assembly to today | `office.html` | front office |
| Just see the schedule | `clock.html` | anyone |

## Draft vs live

`overrides-draft.json` is the working copy. `overrides.json` is what students
read. The editor's **Save draft** writes the draft; **Publish to students**
copies it to the live file. Build February's calendar whenever you like — it
goes nowhere until you publish.

## One copy of the rules

`core.js` holds every scheduling rule and the validator. The extension imports
it directly; the three HTML apps get it inlined by the build step.

```
npm run build      # inline core.js into the HTML apps
npm run validate   # check the JSON files
npm test           # regression tests
```

**Edit `src/*.html`, never the built files in the repo root** — the build
overwrites them.

GitHub Actions runs the validator on every push that touches a schedule file,
so a broken schedule is caught in the repo rather than by students at 8:15.

## Data shape

```jsonc
{
  "version": 1,
  "updated": "2026-10-10",
  "schools": {
    "school-id": {
      "name": "Example High",
      "timezone": "America/Chicago",
      "announcement": { "text": "Pep rally today", "until": "2026-10-20" },
      "week":      { "Monday": "regular" },          // normal weekly pattern
      "rotation":  { "start": "2026-08-19",          // OR a rotating cycle
                     "days": ["Day 1", "Day 2"],
                     "map": { "Day 1": "regular" } },
      "templates": {
        "regular": {
          "label": "Regular Day",
          "periods": [
            { "name": "1st Period", "start": "08:15", "end": "09:05", "track": "both" },
            { "name": "Lunch A",    "start": "11:40", "end": "12:10", "track": "A" }
          ]
        }
      },
      "dates": { "2026-11-26": "no-school" }         // one-off overrides
    }
  }
}
```

A template with no periods means no school. `track` is `both`, `A`, `B`, or `C`;
periods on different tracks may overlap, periods on the same track may not.
The rotation advances on school days only — weekends and no-class days are
stepped over.

## Handing this off

Everything lives in this repo except two things: the GitHub token in the
editor's browser, and the encrypted token on the office computer. Both are
regenerated in minutes. To transfer ownership, move the repo to a
school-owned organisation and have the next person generate their own
fine-grained token with Contents: Read and write on this repo only.
