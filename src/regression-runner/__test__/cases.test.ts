import { describe, expect, it } from 'vitest'
import {
  REGRESSION_DEFAULT_BATCH_LIMIT,
  REGRESSION_PRIORITY_VALUES,
  REGRESSION_STATUS_VALUES,
  parseWebsiteCsv,
  selectBatchCases,
} from '../cases'

const HEADER =
  '\uFEFF环境,网站,页面,,地址,scrape_prompt,保障级别,验证人\n'
const CURRENT_HEADER =
  '\uFEFF环境,网站,页面,,地址,保障级别,验证人,修复人,问题描述,"复现路径\n（提示词和文件）",截图,备注,验收\n'

describe('regression runner case parsing', () => {
  it('parses csv rows with quotes and keeps empty prompt rows', () => {
    const csvText =
      HEADER +
      '全球,google,news,新闻,"https://example.com/search?q=a,b","Extract the main news list.",P0(Major),\n' +
      '全球,reddit,全部帖子,社区,https://reddit.com/r/all/,,P0(Major),\n'

    const parsed = parseWebsiteCsv(csvText)

    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({
      rowIndex: 2,
      site: 'google',
      page: 'news',
      category: '新闻',
      url: 'https://example.com/search?q=a,b',
      scrapePrompt: 'Extract the main news list.',
      level: 'P0(Major)',
    })
    expect(parsed.rows[1]?.scrapePrompt).toBe('')
  })

  it('parses the current worksheet layout without treating level as scrape prompt', () => {
    const csvText =
      CURRENT_HEADER +
      '全球,google,news,新闻,https://example.com/1,P0(Major),,,,,,,,\n'

    const parsed = parseWebsiteCsv(csvText)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({
      rowIndex: 2,
      site: 'google',
      page: 'news',
      category: '新闻',
      url: 'https://example.com/1',
      scrapePrompt: '',
      level: 'P0(Major)',
    })
  })

  it('selects the first five eligible p0 cases in source order', () => {
    const csvText =
      HEADER +
      '全球,google,news,新闻,https://example.com/1,Prompt 1,P0(Major),\n' +
      '全球,google,搜索,搜索,https://example.com/2,Prompt 2,P0(Major),\n' +
      '全球,amazon,今日热卖,电商,https://example.com/3,Prompt 3,P0(Major),\n' +
      '全球,reddit,全部帖子,社区,https://example.com/4,Prompt 4,P0(Major),\n' +
      '全球,youtube,首页推荐,自媒体,https://example.com/5,Prompt 5,P0(Major),\n' +
      '全球,linkedin,帖子feed,职场,https://example.com/6,Prompt 6,P0(Major),\n' +
      '全球,reddit,评论,社区,https://example.com/7,,P0(Major),\n' +
      '全球,temu,热卖商品,电商,https://example.com/8,Prompt 8,P1(Minor),\n'

    const parsed = parseWebsiteCsv(csvText)
    const selected = selectBatchCases(parsed.rows, {
      limit: REGRESSION_DEFAULT_BATCH_LIMIT,
      priorities: [REGRESSION_PRIORITY_VALUES.P0],
    })

    expect(selected.map(row => row.url)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
      'https://example.com/4',
      'https://example.com/5',
    ])
  })

  it('keeps eligible rows from the current worksheet layout even when scrape prompt is blank', () => {
    const csvText =
      CURRENT_HEADER +
      '全球,google,news,新闻,https://example.com/1,P0(Major),,,,,,,,\n' +
      '全球,reddit,all,社区,https://example.com/2,P1(Minor),,,,,,,,\n'

    const parsed = parseWebsiteCsv(csvText)
    const selected = selectBatchCases(parsed.rows, {
      limit: 10,
      priorities: [REGRESSION_PRIORITY_VALUES.P0],
    })

    expect(selected.map(row => row.url)).toEqual(['https://example.com/1'])
  })

  it('treats blank priority rows as p2 and excludes unsupported levels', () => {
    const csvText =
      HEADER +
      '全球,google,news,新闻,https://example.com/1,Prompt 1,,\n' +
      `全球,google,搜索,搜索,https://example.com/2,Prompt 2,${REGRESSION_STATUS_VALUES.P2_BACKLOG},\n` +
      `全球,amazon,今日热卖,电商,https://example.com/3,Prompt 3,${REGRESSION_STATUS_VALUES.P1_MINOR},\n` +
      '全球,reddit,全部帖子,社区,https://example.com/4,Prompt 4,P9(Custom),\n'

    const parsed = parseWebsiteCsv(csvText)
    const selected = selectBatchCases(parsed.rows, {
      limit: 10,
      priorities: [REGRESSION_PRIORITY_VALUES.P2],
    })

    expect(selected.map(row => row.url)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
    ])
  })

  it('selects all eligible rows when no priority filter is provided', () => {
    const csvText =
      HEADER +
      '全球,google,news,新闻,https://example.com/1,Prompt 1,P0(Major),\n' +
      '全球,google,搜索,搜索,https://example.com/2,Prompt 2,,\n' +
      '全球,amazon,今日热卖,电商,https://example.com/3,,P1(Minor),\n'

    const parsed = parseWebsiteCsv(csvText)
    const selected = selectBatchCases(parsed.rows, {
      limit: 10,
    })

    expect(selected.map(row => row.url)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ])
  })
})
