import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildEnrollmentReport,
  buildVisitReport,
  copyText,
  formatVisitTime,
  isMaskedPhone,
} from '../reportText';

describe('buildVisitReport', () => {
  it('lists every field of the group template in order, one per line', () => {
    const text = buildVisitReport({
      agentName: '小李',
      studentName: '张三',
      phone: '13800000000',
      program: '无人机',
      score: 380,
      campusTime: '7月16日 10:00',
      situation: '家长想先看学校',
      homeTime: '',
      address: '长泰区陈巷镇',
    });
    expect(text.split('\n')).toEqual([
      '话务员：小李',
      '学生姓名：张三',
      '家长电话：13800000000',
      '意向专业：无人机',
      '中考分数：380',
      '到校参观时间：7月16日 10:00',
      '情况：家长想先看学校',
      '家访时间：',
      '地址：长泰区陈巷镇',
    ]);
  });

  it('leaves unknown fields blank instead of printing undefined', () => {
    const text = buildVisitReport({ agentName: '小李', studentName: '张三' });
    expect(text).not.toContain('undefined');
    expect(text).toContain('家长电话：');
    expect(text.split('\n')).toHaveLength(9);
  });
});

describe('buildEnrollmentReport', () => {
  it('builds the congratulation post with the region when known', () => {
    expect(
      buildEnrollmentReport({ studentName: '张三', program: '无人机', agentName: '小李', region: '长泰' }),
    ).toBe(
      '[庆祝]喜 报[庆祝]\n学生姓名：张三\n报读专业：无人机\n话务员：小李\n地区：长泰\n再接再厉[烟花][烟花][烟花]',
    );
  });

  it('omits the region line when there is none', () => {
    const text = buildEnrollmentReport({ studentName: '张三', program: '电商', agentName: '小李' });
    expect(text).not.toContain('地区');
  });
});

describe('formatVisitTime', () => {
  it('turns a datetime-local value into a readable time', () => {
    expect(formatVisitTime('2026-07-14T15:30')).toBe('7月14日 15:30');
    expect(formatVisitTime('2026-07-05 09:05:00')).toBe('7月5日 09:05');
  });

  it('keeps free text and empty values', () => {
    expect(formatVisitTime('周六上午')).toBe('周六上午');
    expect(formatVisitTime('')).toBe('');
    expect(formatVisitTime(null)).toBe('');
  });
});

describe('isMaskedPhone', () => {
  it('detects the masked numbers the API returns to agents', () => {
    expect(isMaskedPhone('138****0000')).toBe(true);
    expect(isMaskedPhone('13800000000')).toBe(false);
    expect(isMaskedPhone(undefined)).toBe(false);
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the async clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a hidden textarea when the clipboard API rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true);
    await expect(copyText('hello')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
