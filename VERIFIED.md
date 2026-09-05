# Platform verification — 2026-09-05

Every link below was live at the moment it was tested. Most were harvested from the
platform's own public listing rather than typed, because earlier rounds of this used
invented ids — `twitch.tv/videos/2000000000`, a reddit post of `1abc`, a douyin id of all
zeros — and a link that cannot exist measures nothing except the typing.

Two endpoints, because they answer different questions. `/api/info` asks what video or
audio is at an address; `/api/pictures` asks what photographs a page publishes. Testing an
image platform through the video path reports a failure that is really a category error,
which is what happened to Pinterest and Tumblr on the first pass.

## Verified working, this session

| Platform | Link tested | Path | Result |
|---|---|---|---|
| YouTube | `youtube.com/watch?v=8aulMPhE12g` | info | extractor `Youtube` |
| TikTok | `tiktok.com/@tiktok/video/6807491984882765062` | info | extractor `TikTok` |
| Facebook | `facebook.com/watch/?v=10153231379946729` | info | extractor `Facebook` |
| SoundCloud | `soundcloud.com/forss/flickermood` | info | extractor `Soundcloud` |
| Bluesky | `bsky.app/profile/cee.wtf/post/3muplmkx56s2k` | info | extractor `Bluesky` |
| Dailymotion | `dailymotion.com/video/xb42u0q` | info | extractor `Dailymotion` |
| Bilibili | `bilibili.com/video/BV1Satr6zETw` | info | extractor `BiliBiliBangumi` |
| Instagram | `instagram.com/p/DcyA9jCmCKS/` | pictures | 1 page, source `oembed` |
| Pinterest | `pinterest.com/pin/422281208548614/` | pictures | 2 pages, source `mixed` |
| Tumblr | `bogleech.tumblr.com/post/826707613076111360` | pictures | 1 page, source `page` |
| Xiaohongshu | `xiaohongshu.com` | pictures | 31 pages, source `page` |

## Opened by gallery-dl, installed 2026-09-05

gallery-dl was named first in the image chain in config.js and had never been installed,
so that link never ran. `python` on the PATH turned out to be a 111-byte Microsoft Store
stub, which made every `pip install` exit 0 and install nothing. Installed through the
real interpreter, it brings roughly 960 image extractors.

| Platform | Link tested | Result |
|---|---|---|
| Flickr | `flickr.com/photos/bogush/55505670425` | 5 pictures |
| Imgur | `imgur.com/gallery/eat-rich-oHUgoIP` | 3 pictures |
| ArtStation | `artstation.com/artwork/b0lK6E` | 1 picture |
| Wikimedia Commons | `commons.wikimedia.org/wiki/File:The_A5_-_geograph.org.uk_-_7676796.jpg` | 19 pictures |

None of these four were in the 23 the site lists.

## Refused by the source, with the reason it gave

| Platform | What gallery-dl reported |
|---|---|
| Unsplash | `HttpError: 403 Forbidden` on its own API |
| Pixabay | `Unsupported URL` — no extractor for that address form |
| Reddit | `You've been blocked by network security` |

Recorded as refusals from the far end rather than as faults here, because that is what
the tool itself says when asked directly.

## Fails upstream, in yt-dlp itself

| Platform | Error |
|---|---|
| Vimeo | `Failed to fetch macos OAuth token: HTTP Error 401` — reproduced with bare `yt-dlp`, so not a fault in this application |

## Not tested honestly, and why

Weibo and VK were probed with their homepages rather than post links, which is not a test
of either platform. Reddit's public listing refused the harvester, so no live post id was
obtained. Bandcamp's link returned 404 — the track had moved, so that result says nothing
about Bandcamp. Twitch, Kick, Odysee, Rumble and Mixcloud produced no match from their
listing pages and were left untested rather than guessed at.

These sit in the "listed, not yet checked" column on /sites, and they stay there until a
real link proves otherwise.

## Refused deliberately, by name

Threads and X build their pages in the browser and hide most posts behind a login.
Douyin requires a session cookie. Vidio's manifest 404s.

## Refused because downloading them is unlawful

Netflix, Disney+, Prime Video and Apple TV+ carry DRM; OnlyFans is a paid wall; VdoCipher
and Gumlet are sold as anti-download services. Circumventing a technological protection
measure is an offence under Article 52 of Indonesian Copyright Law 28/2014 and under
DMCA §1201 in the United States. yt-dlp refuses them too.

The lawful route works: the official YouTube trailers for Frankenstein, Loki and
Ironheart — the same titles on that list — all download.

## Reproduce

    npm run universal          # then, in another terminal:
    npm run coverage           # hit rate on links nobody picked
    bash scripts/compare.sh    # this app against bare yt-dlp
