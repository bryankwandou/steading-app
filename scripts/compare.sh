#!/usr/bin/env bash
#
# Steading against yt-dlp alone, on identical links, scored by identical rules.
#
#   npm run universal      # in another terminal
#   bash scripts/compare.sh
#
# This exists because "universal" was being demanded as if it meant a hundred per cent,
# and no downloader has ever met that. yt-dlp is the most complete extractor set that
# exists -- around 1,750 sites under one test suite -- and it fails on sites every day.
# A standard nothing can meet is not a standard; the answerable question is whether this
# matches the reference implementation, and whether it recovers anything the reference
# loses.
#
# Both sides are scored the same way on purpose. An earlier version counted yt-dlp's
# generic extractor as a success and did not extend the same allowance to Steading, which
# made the chain look worse than the tool it contains -- a comparison that flatters
# nobody and measures nothing.
#
# The line that matters is the last one. A program genuinely dependent on one source
# cannot score above that source; every point above it came from somewhere else.

LINKS="https://www.youtube.com/watch?v=dQw4w9WgXcQ|YouTube
https://www.youtube.com/watch?v=jNQXAC9IVRw|YouTube2005
https://vimeo.com/76979871|Vimeo
https://soundcloud.com/forss/flickermood|SoundCloud
https://boc.bandcamp.com/track/dayvan-cowboy|Bandcamp
https://archive.org/details/BigBuckBunny_124|ArchiveOrg
https://www.ted.com/talks/bill_gates_the_next_outbreak_we_re_not_ready|TED
https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_medium.ogv|Wikimedia
https://www.w3schools.com/html/html5_video.asp|w3schools
https://en.wikipedia.org/wiki/Video|Wikipedia"
Y=0; S=0; T=0; ONLY_S=""
printf "  %-13s %-14s %s\n" "LINK" "yt-dlp ALONE" "STEADING (3 sources)"
while IFS='|' read -r url name; do
  [ -z "$url" ] && continue
  T=$((T+1))
  # Same rule both sides: did anything usable come back at all.
  if timeout 75 yt-dlp --dump-single-json --no-warnings "$url" 2>/dev/null | head -c 60 | grep -q '"'; then
    yr="ok"; Y=$((Y+1)); yb=1
  else yr="FAIL"; yb=0; fi
  sr=$(curl -s -m 90 -X POST http://127.0.0.1:3000/api/info -H 'Content-Type: application/json' -d "{\"url\":\"$url\"}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.hasVideo||j.audioOnly||(j.extractor&&j.title))?('ok'+(j.extractor==='page'?' via scraper':'')):'FAIL')}catch(e){console.log('FAIL')}})")
  case "$sr" in ok*) S=$((S+1)); sb=1;; *) sb=0;; esac
  [ "$yb" = "0" ] && [ "$sb" = "1" ] && ONLY_S="$ONLY_S $name"
  printf "  %-13s %-14s %s\n" "$name" "$yr" "$sr"
done <<< "$LINKS"
echo "  ---"
echo "  yt-dlp alone : $Y of $T"
echo "  Steading     : $S of $T"
echo "  recovered by the chain where yt-dlp failed:${ONLY_S:- none}"
