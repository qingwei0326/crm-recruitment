/**
 * 无效线索回收管理页面
 *
 * 功能：
 * 1. 列出所有标记为无效的线索
 * 2. 显示无效原因
 * 3. 批量选择并重新分配给话务员
 */

import React, { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Select,
  message,
  Modal,
  Space,
  Tag,
  Pagination,
} from 'antd';
import { ReloadOutlined, RedoOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Option } = Select;

export default function InvalidStudentReclaim() {
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  // 加载无效线索列表
  const loadInvalidStudents = async (page = 1) => {
    setLoading(true);
    try {
      const response = await axios.get('/api/admin/invalid-students', {
        params: {
          page,
          page_size: pagination.pageSize,
        },
      });
      if (response.data.code === 0) {
        setStudents(response.data.data.list);
        setPagination({
          ...pagination,
          current: page,
          total: response.data.data.total,
        });
      }
    } catch (error) {
      message.error('加载失败：' + (error.response?.data?.msg || error.message));
    } finally {
      setLoading(false);
    }
  };

  // 加载话务员列表
  const loadAgents = async () => {
    try {
      const response = await axios.get('/api/admin/agents');
      if (response.data.code === 0) {
        setAgents(response.data.data);
      }
    } catch (error) {
      console.error('加载话务员列表失败', error);
    }
  };

  useEffect(() => {
    loadInvalidStudents();
    loadAgents();
  }, []);

  // 回收并重新分配
  const handleReclaim = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要回收的线索');
      return;
    }
    if (!selectedAgentId) {
      message.warning('请选择要分配的话务员');
      return;
    }

    Modal.confirm({
      title: '确认回收',
      content: `确定要回收 ${selectedRowKeys.length} 条无效线索并重新分配给选定的话务员吗？`,
      onOk: async () => {
        setLoading(true);
        try {
          const response = await axios.post('/api/admin/reclaim-students', {
            student_ids: selectedRowKeys,
            agent_id: selectedAgentId,
          });
          if (response.data.code === 0) {
            message.success(
              `成功回收 ${response.data.data.reclaimed_count} 条线索，已分配给 ${response.data.data.agent_name}`
            );
            setSelectedRowKeys([]);
            setSelectedAgentId(null);
            loadInvalidStudents(pagination.current);
          } else {
            message.error(response.data.msg);
          }
        } catch (error) {
          message.error('回收失败：' + (error.response?.data?.msg || error.message));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 100,
    },
    {
      title: '地区',
      dataIndex: 'region',
      key: 'region',
      width: 100,
    },
    {
      title: '学校',
      dataIndex: 'school_name',
      key: 'school_name',
      width: 150,
    },
    {
      title: '电话尾号',
      dataIndex: 'guardian_phone',
      key: 'guardian_phone',
      width: 100,
      render: (phone) => phone ? `****${phone}` : '-',
    },
    {
      title: '原话务员',
      dataIndex: 'agent_name',
      key: 'agent_name',
      width: 100,
    },
    {
      title: '无效原因',
      dataIndex: 'invalid_reason',
      key: 'invalid_reason',
      width: 200,
      render: (reason) => (
        <span style={{ color: reason ? '#666' : '#ccc' }}>
          {reason || '未填写'}
        </span>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (time) => time?.replace('T', ' ').substring(0, 19),
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadInvalidStudents(pagination.current)}
          >
            刷新
          </Button>
          <span style={{ marginLeft: 16 }}>
            已选择 <Tag color="blue">{selectedRowKeys.length}</Tag> 条线索
          </span>
        </Space>

        <Space>
          <span>分配给：</span>
          <Select
            style={{ width: 150 }}
            placeholder="选择话务员"
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            allowClear
          >
            {agents.map((agent) => (
              <Option key={agent.id} value={agent.id}>
                {agent.name}
              </Option>
            ))}
          </Select>
          <Button
            type="primary"
            icon={<RedoOutlined />}
            onClick={handleReclaim}
            disabled={selectedRowKeys.length === 0 || !selectedAgentId}
          >
            回收并重新分配
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={students}
        loading={loading}
        rowSelection={rowSelection}
        pagination={false}
        scroll={{ x: 1000 }}
      />

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Pagination
          current={pagination.current}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onChange={(page) => loadInvalidStudents(page)}
          showSizeChanger={false}
          showTotal={(total) => `共 ${total} 条无效线索`}
        />
      </div>
    </div>
  );
}
