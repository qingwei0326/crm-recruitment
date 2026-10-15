import { describe, expect, it } from 'vitest';
import { outcomeSavedMessage } from '../outcomeFeedback';

describe('outcomeSavedMessage', () => {
  it('tells the agent where a missed or contacted student can be found', () => {
    expect(outcomeSavedMessage({ label: '未接', displayStatus: '未接' })).toBe(
      '已标记【未接】，之后在「待处理」里找',
    );
    expect(outcomeSavedMessage({ label: '意向了解加微', displayStatus: '待回访' })).toBe(
      '已标记【意向了解加微】，之后在「待处理」里找',
    );
    expect(outcomeSavedMessage({ label: '非常有意向', displayStatus: '已联系' })).toContain('待处理');
  });

  it('warns that an invalid student leaves the agent list and says how to find it again', () => {
    const message = outcomeSavedMessage({ label: '空号', displayStatus: '无效' });
    expect(message).toContain('【空号】');
    expect(message).toContain('已从你的列表移走');
    expect(message).toContain('搜索');
  });

  it('keeps an untouched student in the call queue', () => {
    expect(outcomeSavedMessage({ label: '新线索', displayStatus: '未联系' })).toContain('待拨打');
  });

  it('falls back to a plain confirmation for other statuses', () => {
    expect(outcomeSavedMessage({ label: '', displayStatus: '已报名' })).toBe('已标记');
  });
});
