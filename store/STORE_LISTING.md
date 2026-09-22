# Chrome Web Store Listing

## Name

Aside Bookmark Sync

## Summary

Sync bookmarks between local Chromium browsers through a loopback-only companion.

## Detailed description

Aside Bookmark Sync keeps bookmarks aligned between Chromium-based browsers on the same Mac without a cloud account or remote synchronization server.

Install the open-source local companion, load or install the extension in each browser, and enter the same local password. Bookmark changes are exchanged only through `127.0.0.1`.

Features:

- local bidirectional bookmark synchronization;
- background create, update, move, and delete handling;
- password-derived local pairing;
- no developer-operated cloud service;
- status, manual sync, retry, and last-sync information in the popup;
- open-source companion and extension code.

The separately installed macOS companion is required. See the support URL for installation instructions.

## Single purpose

Synchronize browser bookmarks between Chromium-based browsers on the same computer through a local authenticated companion.

## Permission justifications

### bookmarks

Required to read the local bookmark tree and create, update, move, or remove bookmarks when applying synchronized changes.

### storage

Required to store the browser label, password-derived local credentials, synchronization revision, change metadata, pending operations, and status.

### alarms

Required to retry and receive synchronization every 30 seconds because Manifest V3 service workers are not persistent.

### http://127.0.0.1:32145/*

Required exclusively to communicate with the loopback-only companion service on the same computer. No external host permission is requested.

## Data-use disclosures

The extension handles website content in the form of bookmark titles and URLs, and authentication information in the form of a password-derived key. This data is used only for the extension's local bookmark synchronization purpose. It is not sold, used for advertising, or transferred to the developer or third parties.

## URLs

- Support: https://github.com/islee23520/aside-bookmark-sync/issues
- Homepage: https://github.com/islee23520/aside-bookmark-sync
- Privacy policy: https://github.com/islee23520/aside-bookmark-sync/blob/main/PRIVACY.md

## Category

Productivity

## Language

English

## Distribution

Public, all regions supported by the Chrome Web Store.
