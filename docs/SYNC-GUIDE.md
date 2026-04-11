# FicForge Multi-Device Sync Guide

## Overview

FicForge supports syncing data between desktop and mobile devices, so you can build your story library on your computer and continue writing on your phone.

## Option 1: Folder Sync (Recommended, Simplest)

### How It Works

Place your AU data directory inside a cloud sync folder (OneDrive / Dropbox / iCloud). Each device syncs files through the cloud client. FicForge detects changes on startup and merges automatically.

### Steps

1. Install OneDrive / Dropbox on your computer
2. Move your FicForge data directory into the cloud sync folder
   - Windows: Move `%APPDATA%/FicForge/data/` to `OneDrive/FicForge/`
   - Or change the data directory path in FicForge global settings
3. Install the same cloud app on your phone
4. Point FicForge mobile to the same sync directory
5. Done! Data stays in sync across both devices

### Notes

- Make sure the cloud client is set to "Always keep on this device" (disable on-demand downloads)
- Avoid editing the same file on both devices simultaneously (conflict resolution exists but manual fixing is tedious)
- Vector indexes are not synced — mobile will rebuild them in the background on first open (~1-2 minutes)

## Option 2: WebDAV Sync

### How It Works

FicForge has a built-in WebDAV client that connects directly to WebDAV-compatible cloud storage services. Useful when you don't have a cloud client on your phone.

### Supported WebDAV Services

- **Nextcloud** (self-hosted): `https://your-domain/remote.php/dav/files/username/`
- **TeraCloud**: `https://nanao.teracloud.jp/dav/`
- **Synology NAS**: `https://NAS-address:5006/`
- **Jianguoyun** (China): `https://dav.jianguoyun.com/dav/`

### Steps

1. Open FicForge → Global Settings → Data Sync
2. Set Sync Mode to "WebDAV"
3. Enter server URL, username, and password
4. Click "Test Connection" to verify
5. Click "Sync Now" for the initial sync
6. Click "Sync Now" each time you want to sync between devices

## What Gets Synced?

| Data | Synced? | Notes |
|------|---------|-------|
| Chapter text | Yes | |
| Character/worldbuilding lore | Yes | |
| Plot points (Facts) | Yes | Synced via operation log for consistency |
| Operation history | Yes | Used to merge changes from both devices |
| Drafts | No | Drafts are temporary and local |
| Global settings | No | API keys and configs are per-device |
| Search indexes | No | Rebuilt locally on each device |

## Handling Conflicts

If both devices modify the same file, FicForge will show a conflict resolution dialog letting you choose which version to keep. Operation history (plot points, etc.) merges automatically without manual intervention.

## FAQ

**Q: My phone says "Building search index in background"?**

A: This is normal. Search indexes are not synced across devices — each device rebuilds them locally (~1-2 minutes). You can continue writing during the rebuild; only smart retrieval is temporarily unavailable.

**Q: Can I use Google Drive / iCloud Drive?**

A: For folder sync (Option 1), yes — as long as the cloud service provides real file sync (not just cloud-only storage). For WebDAV sync (Option 2), only services that support the WebDAV protocol work.
