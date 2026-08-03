import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  FolderPlus,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';

import api from '../api';

export const UNGROUPED_FILTER = 'ungrouped';

const RECENT_GROUPS_STORAGE_PREFIX = 'crm-personal-groups-recent';
const MAX_COMMON_GROUPS = 4;
const DEFAULT_GROUP_COLOR = 'cyan';

const GROUP_TONES = {
  cyan: {
    active: 'border-cyan-600 bg-cyan-600 text-white',
    idle: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200',
    badge: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200',
    swatch: 'bg-cyan-500',
  },
  blue: {
    active: 'border-blue-600 bg-blue-600 text-white',
    idle: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
    badge: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
    swatch: 'bg-blue-500',
  },
  green: {
    active: 'border-green-600 bg-green-600 text-white',
    idle: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200',
    badge: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200',
    swatch: 'bg-green-500',
  },
  amber: {
    active: 'border-amber-600 bg-amber-600 text-white',
    idle: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    badge: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    swatch: 'bg-amber-500',
  },
  rose: {
    active: 'border-rose-600 bg-rose-600 text-white',
    idle: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
    badge: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
    swatch: 'bg-rose-500',
  },
};

function toneFor(color) {
  return GROUP_TONES[color] || GROUP_TONES[DEFAULT_GROUP_COLOR];
}

function apiErrorMessage(error, fallback) {
  return error?.response?.data?.detail || error?.response?.data?.msg || fallback;
}

function emitGroupsChanged(detail) {
  window.dispatchEvent(new CustomEvent('personal-groups-changed', { detail }));
}

function recentGroupsStorageKey() {
  try {
    const user = JSON.parse(localStorage.getItem('crm_user') || 'null');
    return `${RECENT_GROUPS_STORAGE_PREFIX}:${user?.id || 'anonymous'}`;
  } catch {
    return `${RECENT_GROUPS_STORAGE_PREFIX}:anonymous`;
  }
}

function readRecentGroupIds(storageKey) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function usePersonalGroups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    if (typeof api.get !== 'function') {
      setGroups([]);
      setLoading(false);
      return;
    }
    try {
      const response = await api.get('/personal-groups');
      if (response.data.code === 0) {
        setGroups(Array.isArray(response.data.data) ? response.data.data : []);
      }
    } catch (requestError) {
      setGroups([]);
      setError(apiErrorMessage(requestError, '加载私人分组失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const handleChange = () => reload();
    window.addEventListener('personal-groups-changed', handleChange);
    return () => window.removeEventListener('personal-groups-changed', handleChange);
  }, [reload]);

  const createGroup = async ({ name, color = DEFAULT_GROUP_COLOR }) => {
    const trimmedName = name?.trim();
    if (!trimmedName) return null;
    setError('');
    try {
      const response = await api.post('/personal-groups', {
        name: trimmedName,
        color,
      });
      if (response.data.code === 0) {
        const group = response.data.data;
        setGroups((current) => [...current, group]);
        emitGroupsChanged({ action: 'created', groupId: group.id });
        return group;
      }
    } catch (requestError) {
      setError(apiErrorMessage(requestError, '新建分组失败'));
    }
    return null;
  };

  const renameGroup = async (group, name) => {
    const trimmedName = name?.trim();
    if (!trimmedName || trimmedName === group.name) return null;
    setError('');
    try {
      const response = await api.patch(`/personal-groups/${group.id}`, {
        name: trimmedName,
      });
      if (response.data.code === 0) {
        const updatedGroup = response.data.data;
        setGroups((current) => current.map((item) => (
          item.id === group.id ? updatedGroup : item
        )));
        emitGroupsChanged({ action: 'renamed', groupId: group.id });
        return updatedGroup;
      }
    } catch (requestError) {
      setError(apiErrorMessage(requestError, '重命名分组失败'));
    }
    return null;
  };

  const deleteGroup = async (group) => {
    if (!window.confirm(`删除私人分组“${group.name}”？学生正式状态不会改变。`)) return false;
    setError('');
    try {
      const response = await api.delete(`/personal-groups/${group.id}`);
      if (response.data.code === 0) {
        setGroups((current) => current.filter((item) => item.id !== group.id));
        emitGroupsChanged({ action: 'deleted', groupId: group.id });
        return true;
      }
    } catch (requestError) {
      setError(apiErrorMessage(requestError, '删除分组失败'));
    }
    return false;
  };

  return { groups, loading, error, createGroup, renameGroup, deleteGroup };
}

function GroupCreateForm({ onCreate, onCancel, submitLabel = '创建', className = '' }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR);
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const created = await onCreate({ name, color });
      if (created) setName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={name}
          maxLength={20}
          onChange={(event) => setName(event.target.value)}
          placeholder="分组名称"
          aria-label="分组名称"
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-cyan-900/40"
        />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="取消新建分组"
            title="取消"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="group" aria-label="分组颜色">
          {Object.entries(GROUP_TONES).map(([value, tone]) => (
            <button
              key={value}
              type="button"
              onClick={() => setColor(value)}
              aria-label={`${value}色`}
              aria-pressed={color === value}
              className={`h-8 w-8 rounded-full ${tone.swatch} ring-offset-2 dark:ring-offset-gray-800 ${color === value ? 'ring-2 ring-gray-700 dark:ring-gray-100' : ''}`}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {saving ? '处理中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function GroupButton({ group, active, onClick }) {
  const tone = toneFor(group.color);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${group.name} ${group.member_count || 0}`}
      className={`min-h-[40px] shrink-0 rounded-full border px-3 py-2 text-xs font-medium ${active ? tone.active : tone.idle}`}
    >
      {group.name} {group.member_count || 0}
    </button>
  );
}

export function PersonalGroupBadges({ groups, max = 2, className = '' }) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const visible = groups.slice(0, max);
  const remainder = groups.length - visible.length;

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`} aria-label="所属私人分组">
      {visible.map((group) => (
        <span
          key={group.id}
          className={`inline-flex max-w-[9rem] items-center truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${toneFor(group.color).badge}`}
        >
          {group.name}
        </span>
      ))}
      {remainder > 0 && (
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">+{remainder}</span>
      )}
    </div>
  );
}

export function PersonalGroupFilter({ selectedGroupId, onSelect, className = '' }) {
  const { groups, loading, error, createGroup, renameGroup, deleteGroup } = usePersonalGroups();
  const [managingId, setManagingId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const storageKey = useMemo(recentGroupsStorageKey, []);
  const [recentGroupIds, setRecentGroupIds] = useState(() => readRecentGroupIds(storageKey));

  const commonGroups = useMemo(() => {
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const ranked = [...groups].sort((left, right) => (
      (right.member_count || 0) - (left.member_count || 0)
      || left.name.localeCompare(right.name, 'zh-CN')
    ));
    const candidates = [
      ...(typeof selectedGroupId === 'number' && groupById.has(selectedGroupId)
        ? [groupById.get(selectedGroupId)]
        : []),
      ...recentGroupIds.map((id) => groupById.get(id)).filter(Boolean),
      ...ranked,
    ];
    const seen = new Set();
    return candidates.filter((group) => {
      if (seen.has(group.id)) return false;
      seen.add(group.id);
      return true;
    }).slice(0, MAX_COMMON_GROUPS);
  }, [groups, recentGroupIds, selectedGroupId]);

  const filteredGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) => group.name.toLowerCase().includes(query));
  }, [groupSearch, groups]);

  const selectGroup = (groupId) => {
    if (typeof groupId === 'number') {
      setRecentGroupIds((current) => {
        const next = [groupId, ...current.filter((id) => id !== groupId)].slice(0, MAX_COMMON_GROUPS);
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    }
    onSelect(groupId);
    setShowAll(false);
    setGroupSearch('');
  };

  useEffect(() => {
    if (
      !loading
      && typeof selectedGroupId === 'number'
      && !groups.some((group) => group.id === selectedGroupId)
    ) {
      onSelect(null);
    }
  }, [groups, loading, onSelect, selectedGroupId]);

  const handleCreate = async (values) => {
    const group = await createGroup(values);
    if (group) {
      setCreating(false);
      selectGroup(group.id);
    }
    return group;
  };

  const handleRename = async (event, group) => {
    event.preventDefault();
    const renamed = await renameGroup(group, renameValue);
    if (renamed) {
      setRenamingId(null);
      setRenameValue('');
    }
  };

  const handleDelete = async (group) => {
    if (await deleteGroup(group)) {
      setManagingId(null);
      if (selectedGroupId === group.id) onSelect(null);
    }
  };

  const managedGroup = groups.find((group) => group.id === managingId);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex min-h-[36px] items-center justify-between gap-3">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">我的分组</span>
        <div className="flex items-center gap-1">
          {typeof selectedGroupId === 'number' && (
            <button
              type="button"
              onClick={() => setManagingId(managingId === selectedGroupId ? null : selectedGroupId)}
              aria-label="管理当前分组"
              title="管理当前分组"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowAll((current) => !current);
              setGroupSearch('');
            }}
            aria-label={showAll ? '收起全部分组' : '展开全部分组'}
            className="min-h-[36px] px-2 text-xs font-medium text-cyan-700 dark:text-cyan-300"
          >
            {showAll ? '收起' : `全部 ${groups.length}`}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => selectGroup(null)}
          aria-pressed={selectedGroupId == null}
          className={`min-h-[40px] shrink-0 rounded-full border px-3 py-2 text-xs font-medium ${selectedGroupId == null ? 'border-gray-800 bg-gray-800 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900' : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'}`}
        >
          不限分组
        </button>
        <button
          type="button"
          onClick={() => selectGroup(UNGROUPED_FILTER)}
          aria-pressed={selectedGroupId === UNGROUPED_FILTER}
          className={`min-h-[40px] shrink-0 rounded-full border px-3 py-2 text-xs font-medium ${selectedGroupId === UNGROUPED_FILTER ? 'border-gray-700 bg-gray-700 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900' : 'border-dashed border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
        >
          未分组
        </button>
        {commonGroups.map((group) => (
          <GroupButton
            key={group.id}
            group={group}
            active={selectedGroupId === group.id}
            onClick={() => selectGroup(group.id)}
          />
        ))}
        <button
          type="button"
          onClick={() => setCreating((current) => !current)}
          disabled={loading}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full border border-dashed border-cyan-500 px-3 py-2 text-xs font-medium text-cyan-700 dark:text-cyan-300"
          aria-label="新建分组"
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </button>
      </div>

      {creating && (
        <GroupCreateForm
          onCreate={handleCreate}
          onCancel={() => setCreating(false)}
          className="border-t border-gray-200 pt-3 dark:border-gray-700"
        />
      )}

      {showAll && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <input
            value={groupSearch}
            onChange={(event) => setGroupSearch(event.target.value)}
            placeholder="搜索分组名称"
            className="mb-3 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
            {filteredGroups.map((group) => (
              <GroupButton
                key={group.id}
                group={group}
                active={selectedGroupId === group.id}
                onClick={() => selectGroup(group.id)}
              />
            ))}
            {filteredGroups.length === 0 && (
              <div className="py-3 text-xs text-gray-500">没有匹配的分组</div>
            )}
          </div>
        </div>
      )}

      {managedGroup && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2 text-xs dark:border-gray-700">
          {renamingId === managedGroup.id ? (
            <form onSubmit={(event) => handleRename(event, managedGroup)} className="flex min-w-0 flex-1 items-center gap-2">
              <input
                autoFocus
                maxLength={20}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                aria-label="新的分组名称"
                className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <button type="submit" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-blue-600" aria-label="确认重命名">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setRenamingId(null)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500" aria-label="取消重命名">
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-600 dark:text-gray-300">{managedGroup.name}</span>
              <button
                type="button"
                onClick={() => {
                  setRenamingId(managedGroup.id);
                  setRenameValue(managedGroup.name);
                }}
                className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-blue-600"
              >
                <Pencil className="h-3.5 w-3.5" />
                重命名
              </button>
              <button type="button" onClick={() => handleDelete(managedGroup)} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            </>
          )}
        </div>
      )}

      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}

export function PersonalGroupBulkBar({ selectedStudentIds, onApplied, onCancel, className = '' }) {
  const { groups, loading, error: loadError, createGroup } = usePersonalGroups();
  const [groupId, setGroupId] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const selectedCount = selectedStudentIds.length;

  useEffect(() => {
    if (groupId && !groups.some((group) => String(group.id) === String(groupId))) {
      setGroupId('');
    }
  }, [groupId, groups]);

  if (selectedCount === 0) return null;

  const applyToGroup = async (group) => {
    if (!group || saving) return false;
    setSaving(true);
    setError('');
    try {
      for (let index = 0; index < selectedStudentIds.length; index += 200) {
        await api.post(`/personal-groups/${group.id}/members`, {
          student_ids: selectedStudentIds.slice(index, index + 200),
        });
      }
      emitGroupsChanged({
        action: 'members-added',
        groupId: group.id,
        studentIds: selectedStudentIds,
        included: true,
      });
      onApplied?.(group);
      return true;
    } catch (requestError) {
      setError(apiErrorMessage(requestError, '批量加入分组失败'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const applySelected = () => {
    const group = groups.find((item) => String(item.id) === String(groupId));
    return applyToGroup(group);
  };

  const createAndApply = async (values) => {
    const group = await createGroup(values);
    if (!group) return null;
    const applied = await applyToGroup(group);
    if (applied) setCreating(false);
    return applied ? group : null;
  };

  return (
    <div className={`border-y border-cyan-200 bg-cyan-50 px-3 py-3 dark:border-cyan-900 dark:bg-cyan-950/40 ${className}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(9rem,1fr)_auto_auto]">
        <span className="shrink-0 text-sm font-semibold text-cyan-900 dark:text-cyan-100 sm:order-1">已选 {selectedCount} 人</span>
        <select
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
          disabled={loading || saving}
          aria-label="批量加入的分组"
          className="order-3 min-h-[40px] min-w-0 rounded-lg border border-cyan-200 bg-white px-3 text-sm text-gray-900 dark:border-cyan-800 dark:bg-gray-800 dark:text-gray-100 sm:order-2"
        >
          <option value="">选择分组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={applySelected}
          disabled={!groupId || saving}
          className="order-4 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-cyan-700 px-3 text-sm font-medium text-white disabled:opacity-50 sm:order-3"
        >
          <FolderPlus className="h-4 w-4" />
          {saving ? '处理中…' : '加入'}
        </button>
        <div className="order-2 flex items-center justify-end gap-1 sm:order-4">
          <button
            type="button"
            onClick={() => setCreating((current) => !current)}
            disabled={saving}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-cyan-800 hover:bg-cyan-100 dark:text-cyan-200 dark:hover:bg-cyan-900/60"
            aria-label="新建分组并加入"
            title="新建分组并加入"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label="取消批量选择"
            title="取消批量选择"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {creating && (
        <GroupCreateForm
          onCreate={createAndApply}
          onCancel={() => setCreating(false)}
          submitLabel="创建并加入"
          className="mt-3 border-t border-cyan-200 pt-3 dark:border-cyan-900"
        />
      )}
      {(error || loadError) && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error || loadError}</div>}
    </div>
  );
}

export function PersonalGroupMembershipEditor({ studentId, className = '' }) {
  const { groups, loading, error: loadError, createGroup } = usePersonalGroups();
  const [groupIds, setGroupIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [membershipLoading, setMembershipLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setMembershipLoading(true);
    if (typeof api.get !== 'function') {
      setGroupIds([]);
      setMembershipLoading(false);
      return () => {
        cancelled = true;
      };
    }
    api.get(`/personal-groups/student/${studentId}`)
      .then((response) => {
        if (!cancelled) {
          if (response.data.code === 0) {
            const ids = response.data.data?.group_ids;
            setGroupIds(Array.isArray(ids) ? ids : []);
          } else {
            setError(response.data.msg || '加载学生分组失败');
          }
          setMembershipLoading(false);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setGroupIds([]);
          setError(apiErrorMessage(requestError, '加载学生分组失败'));
          setMembershipLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const toggle = async (group) => {
    const included = groupIds.includes(group.id);
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      if (included) {
        await api.delete(`/personal-groups/${group.id}/members/${studentId}`);
        setGroupIds((current) => current.filter((id) => id !== group.id));
      } else {
        await api.post(`/personal-groups/${group.id}/members`, { student_ids: [studentId] });
        setGroupIds((current) => [...current, group.id]);
      }
      emitGroupsChanged({
        action: included ? 'member-removed' : 'member-added',
        studentId,
        groupId: group.id,
        included: !included,
      });
    } catch (requestError) {
      setError(apiErrorMessage(requestError, '更新私人分组失败'));
    } finally {
      setSaving(false);
    }
  };

  const createAndInclude = async (values) => {
    const group = await createGroup(values);
    if (!group) return null;
    setSaving(true);
    setError('');
    try {
      await api.post(`/personal-groups/${group.id}/members`, { student_ids: [studentId] });
      setGroupIds((current) => [...current, group.id]);
      setCreating(false);
      emitGroupsChanged({
        action: 'member-added',
        studentId,
        groupId: group.id,
        included: true,
      });
      return group;
    } catch (requestError) {
      setError(apiErrorMessage(requestError, '分组已创建，但加入学生失败'));
      return null;
    } finally {
      setSaving(false);
    }
  };

  if (loading || membershipLoading) {
    return <div className={`text-sm text-gray-500 ${className}`}>正在加载我的分组…</div>;
  }

  return (
    <div className={className}>
      <div className="mb-2 flex min-h-[36px] items-center justify-between gap-3">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">我的私人分组</div>
        <button
          type="button"
          onClick={() => setCreating((current) => !current)}
          aria-label="在详情中新建分组"
          title="新建分组"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-cyan-700 hover:bg-cyan-50 dark:text-cyan-300 dark:hover:bg-cyan-950/50"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {groups.length === 0 && !creating ? (
        <div className="text-xs text-gray-500">暂未创建分组</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => {
            const included = groupIds.includes(group.id);
            const tone = toneFor(group.color);
            return (
              <button
                key={group.id}
                type="button"
                disabled={saving}
                onClick={() => toggle(group)}
                aria-label={`${group.name} ${included ? '已加入' : '未加入'}`}
                aria-pressed={included}
                className={`inline-flex min-h-[40px] items-center gap-1 rounded-full border px-3 py-2 text-xs font-medium ${included ? tone.active : tone.idle} disabled:opacity-60`}
              >
                {included ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {group.name}
              </button>
            );
          })}
        </div>
      )}
      {creating && (
        <GroupCreateForm
          onCreate={createAndInclude}
          onCancel={() => setCreating(false)}
          submitLabel="创建并加入"
          className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700"
        />
      )}
      {(error || loadError) && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error || loadError}</div>}
    </div>
  );
}
