import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../../api';
import AssistantSettings from '../AssistantSettings';

vi.mock('../../../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

const config = {
  enabled: true,
  base_url: 'https://provider.example/v1',
  endpoint: 'https://provider.example/v1/chat/completions',
  model: 'tool-model',
  api_key_configured: true,
  api_key_last4: 'last',
  protocol: 'openai_chat_completions',
};

function response(data, msg = 'ok') {
  return { data: { code: 0, data, msg } };
}

describe('AssistantSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(response(config));
    api.put.mockResolvedValue(response(config));
    api.post.mockResolvedValue(response({
      ok: true,
      model: 'tool-model',
      tool_calling: true,
    }));
  });

  it('loads masked configuration and saves a replacement key atomically', async () => {
    const user = userEvent.setup();
    render(<AssistantSettings />);
    expect(await screen.findByDisplayValue('https://provider.example/v1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('已配置（末四位 last）')).toHaveValue('');

    await user.type(screen.getByLabelText('AI 助手 API Key'), 'replacement-key');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/admin/assistant/config',
      expect.objectContaining({
        enabled: true,
        base_url: 'https://provider.example/v1',
        model: 'tool-model',
        api_key: 'replacement-key',
        clear_api_key: false,
      }),
    ));
  });

  it('saves current fields before testing OpenAI tool calling', async () => {
    const user = userEvent.setup();
    render(<AssistantSettings />);
    await screen.findByDisplayValue('tool-model');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/admin/assistant/config/test');
    expect(await screen.findByText('连接成功，tool-model 已支持 Tool Calling')).toBeInTheDocument();
  });
});
