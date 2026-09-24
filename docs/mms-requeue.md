# MMS Media in Retool

Retool volunteers reviewing a report can view all of that report's media —
inbound MMS replies plus the original web upload — in a single pane. Pizza
Base exposes this via an authorized endpoint on the existing REST API.

## 1. Retool Query: `getReportMedia`

Create a new REST query in Retool:

- **Method:** `GET`
- **URL:** `{{PIZZA_BASE_URL}}/reports/{{reports.selectedRow.data.id}}/media`
- **Headers:** `Authorization: Basic {{API_KEY}}`

> `reports.selectedRow.data.id` is the selected report's ID in your Retool
> table. The report's public URL (e.g. `https://polls.pizza/report/...`) can
> be passed instead of the numeric id — both resolve.

### Response shape

```json
{
  "report": { "id": 123, "reportURL": "https://polls.pizza/report/..." },
  "media": [
    {
      "id": 456,
      "source": "mms",
      "mediaStatus": "ready",
      "moderationStatus": "pending",
      "sightengineScore": 0.04,
      "createdAt": "2024-11-05T12:00:00.000Z",
      "cdnUrl": "https://media.polls.pizza/uploads/city-state-abc.jpg",
      "processedUrls": { "webp": "...", "mp4": "..." }
    }
  ]
}
```

Media items are returned newest first. Each item includes:

- `source` — `"mms"` for text-in replies, `"web"` for the report's original
  web upload
- `mediaStatus` — `"ready"`, `"processing"`, `"failed"`, or `"none"`
- `moderationStatus` — moderation queue state
- `sightengineScore` — moderation score (null until SightEngine has run)
- `cdnUrl` — direct CDN link; **null while media is processing or failed**
- `processedUrls` — all available processed format variants (webp, mp4,
  jpeg, gif), each CDN-backed

## 2. Retool Table Column

Add a media column to your reports table:

1. **Column type:** `Link` (or `Image` for photo-only setups)
2. **Value:** `{{getReportMedia.data.media[0].cdnUrl}}` — opens the primary
   media in a new tab
3. **Label:** type indicator, e.g.
   `{{getReportMedia.data.media[0].source === "mms" ? "📱 MMS" : "🌐 Web"}}`

For reports with multiple media items, map the full list:

```
{{getReportMedia.data.media.map(m => ({
  url: m.cdnUrl,
  type: m.source,
  status: m.mediaStatus
}))}}
```

Items with `cdnUrl: null` are still in flight (or failed) — show a
"processing…" placeholder rather than a dead link.

## 3. Moderation Queue Context

This endpoint feeds the media moderation queue (#227). Items with
`moderationStatus: "pending"` or a non-null `sightengineScore` surface in the
queue, and the existing SightEngine + EXIF inspection flow operates on the
same uploads — the media endpoint gives reviewers one combined view while the
queue handles triage.
