<!-- Detailed description, en. Paste into the dashboard. Max 16 000 chars. -->

Pagesmith captures the whole web page you are looking at — not just the part on
screen — and saves it as a single image or a PDF. Click the toolbar button or
press Alt+Shift+S; the page scrolls by itself and the pieces are joined into
one picture.

Useful for archiving an article, sending a design review, attaching a long
dashboard to a ticket, or keeping a record of a receipt or a booking.

WHAT YOU GET
• The whole page, from top to bottom, in one image
• Sticky headers and floating chat buttons shown once, at the top, instead of on every screen
• Lazy-loaded images loaded before the capture starts
• Web apps that scroll an inner panel (mail, chat, dashboards) captured in full
• PNG or JPEG download, PDF in A4, Letter or fit-to-content sizes, or copy to the clipboard
• Very tall pages split into several images automatically, all included in the PDF
• Recent captures kept in the extension so you can download them again
• Keeps going if you close the popup; progress shows on the toolbar icon
• Dark mode, following your system
• English, French, German, Spanish and Japanese

NOTHING LEAVES YOUR BROWSER

Captures are stored only on your computer, in the extension's own storage, and
older ones are deleted automatically. Pagesmith makes no network requests at
all: the shipped code contains no way to send data anywhere, and a check in the
build pipeline fails if that ever changes.

IT ASKS FOR NO SITES WHEN YOU INSTALL IT

Pagesmith uses Chrome's "active tab" permission. It can only see the tab you
click its button on, and only until you navigate away. There is no "read and
change all your data on all websites" prompt.

OPEN SOURCE, AND YOU CAN CHECK THE BUILD

The source is on GitHub under the MIT licence. Every release is
byte-for-byte reproducible from that source and carries a signed provenance
attestation, so you can confirm that what you installed is what was published.

LIMITS
• Chrome does not allow any extension to capture its own pages (chrome://…) or other extensions' pages
• On the Chrome Web Store itself only the visible area can be captured
• Endless feeds stop at a height you can set in Options (40,000 pixels by default)
