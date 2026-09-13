const STATE_NOTIFICATION_TYPES = new Set([
  "sla_breach",
  "sla_warning",
  "contract_renewal",
  "device_offline",
  "ticket_assigned",
  "new_lead",
]);

const notificationKeys = (notification, index) => {
  if (!STATE_NOTIFICATION_TYPES.has(notification?.type) || !notification?.ref_type || !notification?.ref_id) {
    return [`notification:${notification?.id || index}`];
  }
  const keys = [`record:${notification.type}:${notification.ref_type}:${notification.ref_id}`];
  if (notification.title && notification.message) {
    // Some legacy generators retained the same state event under a replaced
    // domain id. Identical user-facing state evidence is one inbox item; every
    // backing notification id is still preserved for read and dismiss actions.
    keys.push(`event:${notification.type}:${notification.title}:${notification.message}`);
  }
  return keys;
};

export function coalesceStateNotifications(notifications = []) {
  const aliases = new Map();
  const groups = [];
  const sorted = [...notifications].sort((left, right) => (
    new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime()
  ));

  sorted.forEach((notification, index) => {
    const keys = notificationKeys(notification, index);
    const existing = keys.map(key => aliases.get(key)).find(Boolean);
    if (!existing) {
      const group = {
        ...notification,
        related_ids: notification?.id ? [notification.id] : [],
        occurrence_count: 1,
      };
      groups.push(group);
      keys.forEach(key => aliases.set(key, group));
      return;
    }

    keys.forEach(key => aliases.set(key, existing));
    if (notification?.id && !existing.related_ids.includes(notification.id)) {
      existing.related_ids.push(notification.id);
    }
    existing.occurrence_count += 1;
    existing.read = Boolean(existing.read && notification.read);
  });

  return groups;
}

export function notificationRecordIds(notification) {
  if (Array.isArray(notification?.related_ids) && notification.related_ids.length > 0) {
    return notification.related_ids;
  }
  return notification?.id ? [notification.id] : [];
}

export function selectedNotificationRecordIds(notifications, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  return notifications
    .filter((notification) => selected.has(notification.id))
    .flatMap(notificationRecordIds);
}
