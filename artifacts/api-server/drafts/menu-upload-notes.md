# Menu upload — inactive drafts

`menu-upload-page.jsx.txt` and `menu-upload.js.txt` preserve the supplied frontend and backend snippets. Neither is imported, routed, or enabled.

The backend currently returns success without persisting files, links, or text. Memory storage is temporary and is not saved draft storage.

Before activation, add authorized restaurant identification using canonical Google Place IDs, persistent storage, upload size and content-type validation, safe handling of missing files, rate limits, input validation, and explicit error handling. Return success only after the menu submission is stored successfully.

Menu uploads do not technically require Stripe; they are on hold because the user requested draft-only work while supplying more code.