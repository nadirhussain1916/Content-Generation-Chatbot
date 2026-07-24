# TikTok Content Posting API — Media Transfer Guide

Source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide/

---

## Two Methods

### 1. FILE_UPLOAD
- Use when video is **on the user's device** (PC, Mac, etc.)
- Init returns `upload_url`, `chunk_size`, `total_chunk_count`
- PUT binary chunks to `upload_url` with `Content-Range` headers
- **Do NOT use if content is already on server-side storage — use PULL_FROM_URL instead**

#### Chunk Rules
- Each chunk: min 5MB, max 64MB
- Final chunk: can exceed `chunk_size` (up to 128MB) for trailing bytes
- Videos < 5MB: upload whole (`chunk_size = video_size`, `total_chunk_count = 1`)
- Videos > 64MB: must use multiple chunks
- Min 1 chunk, max 1000 chunks
- Chunks must be uploaded **sequentially**
- `total_chunk_count = floor(video_size / chunk_size)`

#### HTTP Schema
```
PUT {UPLOAD_URL} HTTP/1.1
Content-Type: video/mp4
Content-Length: {BYTE_SIZE_OF_THIS_CHUNK}
Content-Range: bytes {FIRST_BYTE}-{LAST_BYTE}/{TOTAL_BYTE_LENGTH}

BINARY_FILE_DATA
```

#### Response Codes
| HTTP | Status | Meaning |
|------|--------|---------|
| 201 | Created | All parts uploaded — TikTok starts posting |
| 206 | Partial | Chunk accepted, more to upload |
| 400 | Bad Request | Malformed headers or wrong Content-Length |
| 403 | Forbidden | `upload_url` has expired |
| 404 | Not Found | Invalid upload task |
| 416 | Range Not Satisfiable | Content-Range doesn't match actual progress |
| 5xx | Server Error | Retry this chunk |

Response header: `Content-Range: bytes 0-{UPLOADED_BYTES}/{TOTAL_BYTE_LENGTH}`

---

### 2. PULL_FROM_URL ✅ (correct method for server-side R2 storage)
- Use when content is **already on server-side storage** (our case: R2)
- TikTok server downloads from provided URL at up to **100 Mbps ingress**
- Init with `source=PULL_FROM_URL`, provide `video_url`

#### Prerequisites
- URL must be `https://` — no plain HTTP
- URL must **not redirect** to another URL
- URL must remain accessible for **1 hour** after task is initiated
- Domain must be **ownership-verified** in TikTok Developer Portal

#### Domain Verification
- Verify at: TikTok Developer Portal → App → URL properties
- DNS TXT record: `tiktok-developers-site-verification={TOKEN}` at the subdomain being verified
- Once `creator-os-assetes.winwcag.com` is verified, ALL paths under it are covered
  - e.g. `https://creator-os-assetes.winwcag.com/anything/video.mp4` ✅
- Subdomains of verified domain are also covered
  - e.g. `https://sub.creator-os-assetes.winwcag.com/video.mp4` ✅

#### Cancel an Ongoing Pull
```
POST /v2/post/publish/cancel/
Authorization: Bearer {AccessToken}
{ "publish_id": "{PUBLISH_ID}" }
```

---

## Video Restrictions
| Property | Restriction |
|----------|-------------|
| Formats | MP4 (recommended), WebM, MOV |
| Codecs | H.264 (recommended), H.265, VP8, VP9 |
| FPS | 23–60 FPS |
| Dimensions | 360px–4096px (width & height) |
| Duration | Up to 10 minutes via API |
| File size | Max 4GB |

## Image Restrictions
| Property | Restriction |
|----------|-------------|
| Formats | WebP, JPEG |
| Max resolution | 1080p |
| File size | Max 20MB per image |

---

## Our Setup
- **Method:** PULL_FROM_URL (R2 content already on server)
- **Asset domain:** `creator-os-assetes.winwcag.com`
- **DNS TXT:** `tiktok-developers-site-verification=7xCi8Hhrvp5NdESVBqExqQDsfcxBEWNP` at `creator-os-assetes.winwcag.com`
- **ASSETS_PUBLIC_URL:** `https://creator-os-assetes.winwcag.com`
- **Workflow:** `PublishWorkflow` in `backend/src/workflows/publish.ts`
