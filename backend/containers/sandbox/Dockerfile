# Cloudflare Sandbox image for ffmpeg-based video stitching.
# Keep this tag in sync with the @cloudflare/sandbox package version in package.json.
FROM docker.io/cloudflare/sandbox:0.12.9

# ffmpeg  — concatenate video chunks and extract last frames for chaining.
# media-types — provides /etc/mime.types so the s3fs-backed R2 mount tags written
#               objects with the correct Content-Type (.mp4 → video/mp4, .png → image/png).
RUN apt-get update && apt-get install -y ffmpeg media-types && rm -rf /var/lib/apt/lists/*

# Required for the Sandbox control server / local port exposure.
EXPOSE 3000
