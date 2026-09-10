#!/usr/bin/env python3
"""
Derive the on-chain artwork from the master file.

The master (nft/course-nft.svg) is a 1254x1254 raster illustration wrapped in an
SVG element, about 1.7 MB. A contract's runtime bytecode cannot exceed 24,576
bytes (EIP-170), and the contract logic already uses about 6.9 KB, so the artwork
has roughly 17 KB to live in.

This script downscales the master and re-encodes it as WebP, which is small
enough to store in the contract while staying legible. The output is committed as
nft/course-nft-onchain.webp and is the exact byte string embedded in the contract.

Only needed when the master artwork changes:

    pip install pillow
    python3 scripts/make-onchain-image.py

Then run `npm run embed:image` and `forge test`.
"""
import base64
import io
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This script needs Pillow:  pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "nft" / "course-nft.svg"
OUT = ROOT / "nft" / "course-nft-onchain.webp"

SIZE = 512
QUALITY = 65
# Leaves roughly 3 KB of headroom under EIP-170 after the contract logic.
BUDGET = 17_000


def load_master_pixels(path: Path) -> Image.Image:
    """The master is an <image> element carrying a base64 raster payload."""
    raw = path.read_bytes()
    match = re.search(rb'href="data:image/[a-z+]+;base64,([A-Za-z0-9+/=]+)"', raw)
    if not match:
        sys.exit(f"{path.name} does not contain an embedded base64 raster image")
    return Image.open(io.BytesIO(base64.b64decode(match.group(1)))).convert("RGB")


def main() -> None:
    master = load_master_pixels(MASTER)
    print(f"master      : {master.width}x{master.height}, {MASTER.stat().st_size:,} bytes on disk")

    resized = master.resize((SIZE, SIZE), Image.LANCZOS)
    buffer = io.BytesIO()
    resized.save(buffer, "WEBP", quality=QUALITY, method=6)
    data = buffer.getvalue()

    if len(data) > BUDGET:
        sys.exit(
            f"Encoded artwork is {len(data):,} bytes, over the {BUDGET:,} byte budget.\n"
            f"Lower QUALITY or SIZE in this script and try again."
        )

    OUT.write_bytes(data)
    print(f"on-chain    : {SIZE}x{SIZE} WebP q{QUALITY}, {len(data):,} bytes")
    print(f"headroom    : {BUDGET - len(data):,} bytes under budget")
    print(f"wrote       : nft/{OUT.name}")


if __name__ == "__main__":
    main()
