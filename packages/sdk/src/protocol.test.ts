import { describe, expect, it } from 'vitest'
import { parseHostToPluginMessage, parsePluginToHostMessage } from './protocol'

describe('plugin protocol record fields', () => {
  it('parses activation config records', () => {
    expect(parseHostToPluginMessage({
      id: 'activate-1',
      type: 'activate',
      config: { projectKey: 'ENG', cliPath: '/usr/local/bin/jira' },
    })).toEqual({
      id: 'activate-1',
      type: 'activate',
      config: { projectKey: 'ENG', cliPath: '/usr/local/bin/jira' },
    })
  })

  it('parses native-process environment records', () => {
    expect(parsePluginToHostMessage({
      id: 'exec-1',
      type: 'nativeProcess.execFile',
      file: '/usr/local/bin/jira',
      args: ['issue', 'list'],
      options: { env: { JIRA_API_TOKEN: 'secret' } },
    })).toMatchObject({
      type: 'nativeProcess.execFile',
      options: { env: { JIRA_API_TOKEN: 'secret' } },
    })
  })

  it('parses work-item custom-field records', () => {
    expect(parsePluginToHostMessage({
      id: 'list-1',
      type: 'workItems.list.result',
      items: [{
        id: 'ENG-1',
        source: 'jira',
        externalRef: 'ENG-1',
        title: 'Fix installer',
        body: '',
        status: 'open',
        customFields: { sprint: 'Sprint 1' },
        links: [],
      }],
    })).toMatchObject({
      type: 'workItems.list.result',
      items: [{ customFields: { sprint: 'Sprint 1' } }],
    })
  })
})
