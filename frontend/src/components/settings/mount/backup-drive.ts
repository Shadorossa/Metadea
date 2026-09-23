// Settings › Backup › Google Drive: link/unlink, schedule + keep-N, "back up
// now", and the list of remote backups with a restore button each.
import { getT } from '../../../i18n/runtime';
import { formatAppError } from '../../../lib/errors/format-error';
import { formatBytes, needsRelink, parseKeepLast, parseSchedule } from '../../../lib/backup/backup-settings';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { onDriveStateChanged } from '../../../lib/tauri/backup';
import {
  driveCancelLink, driveLink, driveList, driveRestore, driveSetOptions, driveStatus, driveUnlink, driveUploadNow,
  type DriveStatus, type RemoteBackup,
} from '../../../lib/tauri/google-drive';
import { confirmRestore, formatBackupDate } from './backup-confirm';
import type { BackupProgressView } from './backup-progress';
import { afterRestorePrepared, describeError, statusSetter } from './backup-status';
import { accountEmailHint } from '../../../lib/tauri/auth';

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function renderAccount(status: DriveStatus) {
  const account = status.account;
  const name = byId('backup-drive-name');
  const email = byId('backup-drive-email');
  const avatar = byId<HTMLImageElement>('backup-drive-avatar');
  const initial = byId('backup-drive-initial');
  const label = account?.name || account?.email || '';
  if (name) name.textContent = account?.name || account?.email || '';
  if (email) email.textContent = account?.email ? interpolate(getT().backup.drive_linked_as, { email: account.email }) : '';
  if (initial) initial.textContent = label.slice(0, 1).toUpperCase();
  if (avatar) {
    // Rust only passes https photo links through; checked again before use.
    const photo = account?.photoUrl && /^https:\/\//i.test(account.photoUrl) ? account.photoUrl : '';
    avatar.hidden = !photo;
    avatar.alt = getT().backup.drive_avatar_alt;
    if (photo) {
      avatar.onerror = () => { avatar.hidden = true; };
      avatar.src = photo;
    } else {
      avatar.removeAttribute('src');
    }
  }
}

function renderLastUpload(status: DriveStatus) {
  const t = getT();
  const last = byId('backup-drive-last');
  if (last) {
    last.removeAttribute('data-i18n');
    const lines: string[] = [];
    lines.push(status.lastUploadAt
      ? interpolate(t.backup.drive_last_upload, { date: formatBackupDate(status.lastUploadAt), size: formatBytes(status.lastUploadSize) })
      : t.backup.drive_last_upload_never);
    if (status.lastCheckAt) lines.push(interpolate(t.backup.drive_last_check, { date: formatBackupDate(status.lastCheckAt) }));
    last.textContent = lines.join(' · ');
  }
  const error = byId('backup-drive-error');
  if (error) {
    error.hidden = !status.lastError;
    if (status.lastError) {
      const message = interpolate(t.backup.drive_last_error, { error: formatAppError(status.lastError, t) });
      error.textContent = needsRelink(status.lastError) ? `${message} ${t.backup.drive_relink_hint}` : message;
    }
  }
}

function renderStatus(status: DriveStatus) {
  const unconfigured = byId('backup-drive-unconfigured');
  const unlinked = byId('backup-drive-unlinked');
  const linked = byId('backup-drive-linked');
  if (unconfigured) unconfigured.hidden = status.configured || status.linked;
  if (unlinked) unlinked.hidden = !status.configured || status.linked;
  if (linked) linked.hidden = !status.linked;
  if (!status.linked) return;
  renderAccount(status);
  renderLastUpload(status);
  const schedule = byId<HTMLSelectElement>('backup-drive-schedule');
  const keep = byId<HTMLInputElement>('backup-drive-keep');
  if (schedule) schedule.value = status.schedule;
  if (keep) keep.value = String(status.keepLast);
}

function remoteItem(remote: RemoteBackup, onRestore: (remote: RemoteBackup, button: HTMLButtonElement) => void): HTMLLIElement {
  const t = getT();
  const item = document.createElement('li');
  item.className = 'backup-remote-item';
  const text = document.createElement('div');
  text.className = 'backup-remote-item-text';
  const title = document.createElement('span');
  title.textContent = interpolate(t.backup.drive_remote_meta, { date: formatBackupDate(remote.createdAt), size: formatBytes(remote.size) });
  const detail = document.createElement('span');
  detail.textContent = remote.appVersion ? `${remote.name} · Metadea ${remote.appVersion}` : remote.name;
  text.append(title, detail);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--sm btn--secondary';
  button.dataset.backupAction = '';
  button.textContent = t.backup.drive_restore;
  button.addEventListener('click', () => onRestore(remote, button));
  item.append(text, button);
  return item;
}

export function initDriveBackup(progress: BackupProgressView) {
  const setStatus = statusSetter(byId('backup-drive-status'));
  const list = byId<HTMLUListElement>('backup-drive-list');
  const listEmpty = byId('backup-drive-list-empty');
  const linking = byId('backup-drive-linking');
  const linkButton = byId<HTMLButtonElement>('backup-drive-link-btn');
  let current: DriveStatus | null = null;

  const restore = async (remote: RemoteBackup, button: HTMLButtonElement) => {
    setStatus('');
    const summary = { createdAt: remote.createdAt, appVersion: remote.appVersion, fileCount: null, size: remote.size, legacy: false };
    if (!(await confirmRestore(summary, button))) return;
    try {
      const result = await progress.run(() => driveRestore(remote.id, remote.size));
      afterRestorePrepared(result, setStatus);
    } catch (error) {
      setStatus(describeError(error), 'error');
    }
  };

  const loadList = async () => {
    if (!list || !current?.linked) return;
    list.replaceChildren();
    if (listEmpty) {
      listEmpty.hidden = false;
      listEmpty.removeAttribute('data-i18n');
      listEmpty.textContent = getT().backup.drive_remote_loading;
    }
    try {
      const remotes = await driveList();
      list.replaceChildren(...remotes.map(remote => remoteItem(remote, restore)));
      if (listEmpty) {
        listEmpty.hidden = remotes.length > 0;
        listEmpty.textContent = getT().backup.drive_remote_empty;
      }
    } catch (error) {
      if (listEmpty) {
        listEmpty.hidden = false;
        listEmpty.textContent = describeError(error);
      }
    }
  };

  const apply = (status: DriveStatus) => {
    const wasLinked = current?.linked;
    current = status;
    renderStatus(status);
    if (status.linked && !wasLinked) void loadList();
  };

  const refresh = () => driveStatus().then(apply).catch(() => {});
  void refresh();
  void onDriveStateChanged(() => {
    void refresh();
    void loadList();
  }).catch(() => null);

  linkButton?.addEventListener('click', async () => {
    const t = getT();
    setStatus('');
    linkButton.disabled = true;
    if (linking) linking.hidden = false;
    try {
      const hint = await accountEmailHint();
      apply(await driveLink({ title: t.backup.drive_browser_title, body: t.backup.drive_browser_body }, hint));
    } catch (error) {
      const unlinkedStatus = byId('backup-drive-unlinked');
      unlinkedStatus?.querySelector('.backup-status--error')?.remove();
      // Cancelling is the user's own choice, not an error to report.
      if (unlinkedStatus && !String(error).startsWith('E_GDRIVE_LOGIN_CANCELLED')) {
        const message = document.createElement('p');
        message.className = 'backup-status backup-status--error';
        message.setAttribute('role', 'alert');
        message.textContent = describeError(error);
        unlinkedStatus.append(message);
      }
    } finally {
      linkButton.disabled = false;
      if (linking) linking.hidden = true;
    }
  });

  byId('backup-drive-cancel-link-btn')?.addEventListener('click', () => {
    void driveCancelLink().catch(() => false);
  });

  byId('backup-drive-unlink-btn')?.addEventListener('click', async () => {
    if (!window.confirm(getT().backup.drive_unlink_confirm)) return;
    try {
      apply(await driveUnlink());
      list?.replaceChildren();
    } catch (error) {
      setStatus(describeError(error), 'error');
    }
  });

  const saveOptions = async () => {
    const schedule = byId<HTMLSelectElement>('backup-drive-schedule');
    const keep = byId<HTMLInputElement>('backup-drive-keep');
    if (!schedule || !keep) return;
    try {
      apply(await driveSetOptions(parseSchedule(schedule.value), parseKeepLast(keep.value)));
    } catch (error) {
      setStatus(describeError(error), 'error');
    }
  };
  byId('backup-drive-schedule')?.addEventListener('change', () => { void saveOptions(); });
  byId('backup-drive-keep')?.addEventListener('change', () => { void saveOptions(); });

  byId('backup-drive-upload-btn')?.addEventListener('click', async () => {
    setStatus('');
    try {
      await progress.run(() => driveUploadNow());
      setStatus(getT().backup.drive_upload_success, 'success');
    } catch (error) {
      setStatus(describeError(error), 'error');
    }
    await refresh();
    await loadList();
  });

  byId('backup-drive-refresh-btn')?.addEventListener('click', () => { void loadList(); });
}
