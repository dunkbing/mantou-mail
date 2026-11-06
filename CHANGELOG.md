# Changelog

User-visible changes, one line each, newest first. Format: [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

- Suggest replies: the reply box has a Suggest replies button. The agent offers three short replies as chips in place of the fixed ones; pressing one adds it to the reply, which you still edit and send yourself. Same consent and no tools as summaries.

- Summaries: long conversations (five messages or more, or about 1,500 words) get a Summarise button above the messages. The agent writes up to three plain lines, kept until the conversation changes. It reads only that conversation and has no tools; it asks once before reading anything.

- "Review my inbox" in the Queue: an agent (Claude, through your own Claude login, no API key) looks through your mail and suggests what to archive, label or snooze, each with a reason. It can only suggest; it can't send, delete, run commands or open links. It asks once before it reads anything.

- Updated Mantou to 0.6.0: the colour scheme follows the Linux desktop's dark preference by itself (the app's own check is gone), plus new components, motion and layout fixes.

- A Queue at the top of the sidebar for what the agent suggests (archive these, label those, snooze that), each with its reason. Approve or Dismiss (Enter and X for the first); an approval is done like your own change and Undo takes it back. Nothing changes until you approve.

- Formatting when writing: a bar above the text (bold, italic, link, lists, quote, code) and ⌘/Ctrl+B, I and K. Press again to undo; it works on the selection, or on the lines it touches for lists.

- Updated Mantou to 0.5.0: Linux packages (.deb, .tar.gz and AppImage) and a Windows installer come from Mantou itself, with the app's icon.
- Linux: an AppImage, for distributions that don't use .deb packages.
- Mail with HTML (newsletters, GitHub notifications, receipts) now shows as designed: layout, colours, buttons, tables and the pictures inside the message. Pictures from the web stay blocked until you press "Load pictures"; links open in your browser. In dark mode, mail that has no dark styles is shown on a white page so it stays readable.
- Updated Mantou to 0.5.2: faster typing in long text and lighter memory use, text selection in HTML mail drawn on the GPU, startup failures leave a crash.log.
- Updated Mantou to 0.4.1: `<Html>`, which draws a static HTML/CSS document in the core (no scripts, nothing fetched but through the app).

- Linux: Mantou Mail comes as a .deb and as a .tar.gz with an install script, with its own icon and an entry in the applications menu.
- Big mailboxes scroll and switch faster: the message list only draws the rows in view (2,000 messages: about a third of the work to open, a tenth to switch mailboxes).
- Linux: right-clicking a message opens its menu (reply, archive, snooze, label and the rest), drawn by the app; arrow keys, Enter and Esc work in it.
- Linux: the app follows the desktop's light or dark appearance (GNOME, KDE and others), and changes with it.
- Right-clicking a message selects it at once, before the menu opens (it used to be selected only after the menu was closed).
- Web links in messages are underlined and open in your browser when clicked.
- Updated Mantou to 0.3.1: rich text (the links), and fixes that let the app drop its workarounds for the menu bar, the Edit menu's shortcuts and the right-click menu's position.
- Mail that Gmail keeps in two folders no longer shows a conversation count ("2") for a few seconds after the app opens, and the conversation no longer lists it twice.
- Dismissing a right-click menu with a click no longer selects the message under the pointer.
- The message list no longer redraws every row when the server's mail refreshes and nothing changed.
- macOS: no title bar; the window's traffic-light buttons float over the sidebar, and the window can be moved by the strip under them or by the toolbar.
- The selected conversation stays selected when the server's mail refreshes (it used to jump back to the first one when its copy came back as another message).
- Updated Mantou to 0.2.1: a window can hide its title bar and keep the traffic lights (for a custom title row later).
- Shift+click and Ctrl/⌘+click keep working after a right-click menu has been closed.
- Right-clicking one of several picked conversations keeps them picked, and the menu applies to all of them.
- Select several conversations with Shift+click (a range) or Ctrl/⌘+click (one more), then archive, delete, star, mark unread or move them to the Inbox together.
- Text in an open message can be selected and copied.
- Dark mode: the app follows the system's light or dark appearance, and changes with it.
- Dropping files on the window while writing a message attaches them.
- The dock icon shows how many messages are unread (macOS).
- New mail shows a notification when the app isn't the window in front.
- Updated Mantou to 0.2.0: attachments and sign-in pages open through Mantou, the same on every system (and drag and drop, text styles, themes and window control are there for later).
- A right click on a message opens a menu of what to do with it (reply, archive, snooze, label, star and so on).
- Taking an address suggestion puts the caret after it, without remaking the field.
- Drafts are kept in the server's Drafts folder: saving or editing one replaces its copy there, and sending or discarding it removes it.
- Each account can have a signature (in Accounts); it goes under mail you send from that account.
- On macOS the app menu (Mantou Mail, File, Edit, Message, View, Window, Help) now shows, and Cmd+A, C, X, V and Z work in text fields.
- Updated Mantou to 0.1.7: the caret can be placed in a field, and a right click can open a menu.
