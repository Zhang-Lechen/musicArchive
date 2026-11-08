import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { repository } from '../../db/repository';
import { topListeningComposers } from '../../domain/statistics';

const percent = (value: number) =>
  `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: value > 0 && value < 0.0001 ? 4 : 2 })}%`;
const colors = ['#285440', '#68856b', '#a5b49b', '#b89a68', '#687f89', '#9b827c', '#c2c5ad'];

function ChartEmpty({
  children = '完整听过作品后，这里会呈现你的聆听足迹。',
}: {
  children?: string;
}) {
  return (
    <div className="chart-empty">
      <p>{children}</p>
      <Link to="/composers">浏览作曲家目录，开始记录</Link>
    </div>
  );
}

export function StatisticsPage() {
  const statistics = useLiveQuery(() => repository.listeningStatistics(), []);
  const [sort, setSort] = useState<'count' | 'coverage'>('count');
  if (!statistics) return <p role="status">正在读取本地聆听统计…</p>;
  const top = topListeningComposers(statistics.composers, sort);
  const maxCount = Math.max(1, ...top.map((row) => row.completed));
  const maxYearCount = Math.max(1, ...statistics.years.map((row) => row.count));
  let angle = 0;
  const stops: string[] = [];
  for (const [index, genre] of statistics.genres.entries()) {
    const start = angle;
    angle += genre.percentage * 360;
    stops.push(`${colors[index % colors.length]} ${start}deg ${angle}deg`);
  }
  return (
    <section aria-labelledby="statistics-title">
      <p className="eyebrow">LISTENING JOURNAL</p>
      <h1 id="statistics-title">聆听统计</h1>
      <p className="page-intro">每部完整听过的作品，都是一段独一无二的记忆。</p>
      <dl className="statistics-overview" aria-label="聆听概览" aria-live="polite">
        <div>
          <dt>完整听过的作品</dt>
          <dd data-testid="statistics-completed">
            {statistics.completed.toLocaleString()}
            <small> 部</small>
          </dd>
        </div>
        <div>
          <dt>部分听过的作品</dt>
          <dd data-testid="statistics-partial">
            {statistics.partial.toLocaleString()}
            <small> 部</small>
          </dd>
        </div>
        <div>
          <dt>已听作品涉及的作曲家</dt>
          <dd data-testid="statistics-composers">
            {statistics.composerCount.toLocaleString()}
            <small> 位</small>
          </dd>
        </div>
        <div>
          <dt>作品总体覆盖率</dt>
          <dd data-testid="statistics-coverage">{percent(statistics.coverage)}</dd>
          <p>
            {statistics.completed.toLocaleString()} / {statistics.total.toLocaleString()}{' '}
            部可统计作品
          </p>
        </div>
      </dl>
      {statistics.completed === 0 && <ChartEmpty />}
      <div className="statistics-charts">
        <section className="statistics-panel composer-chart" aria-labelledby="composer-chart-title">
          <div className="chart-heading">
            <div>
              <h2 id="composer-chart-title">按作曲家统计已听作品数</h2>
              <p className="muted small">已完整听过的作曲家 · 前 10 位 · 点击姓名查看作品目录</p>
            </div>
            <label>
              作曲家统计排序
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="count">已听作品数</option>
                <option value="coverage">目录覆盖率</option>
              </select>
            </label>
          </div>
          {!top.length ? (
            <ChartEmpty />
          ) : (
            <ol className="composer-bars" aria-label="作曲家聆听横向柱状图">
              {top.map((row) => (
                <li key={row.id}>
                  <Link to={`/composers/${row.id}`}>{row.name}</Link>
                  <div className="horizontal-bar-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${(row.completed / maxCount) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="bar-value">
                    {row.completed} 部 <small>· {percent(row.coverage)}</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="statistics-panel" aria-labelledby="genre-chart-title">
          <h2 id="genre-chart-title">已听作品的体裁分布</h2>
          <p className="muted small">沿用目录体裁，不从作品名称推断类别。</p>
          {!statistics.genres.length ? (
            <ChartEmpty />
          ) : (
            <div className="genre-chart">
              <div
                className="genre-donut"
                role="img"
                aria-label={`已听 ${statistics.completed} 部作品的体裁环形图，数量和比例详见下方图例`}
                style={{ background: `conic-gradient(${stops.join(',')})` }}
              >
                <span>
                  {statistics.completed}
                  <small>部完整作品</small>
                </span>
              </div>
              <ul className="genre-legend" aria-label="体裁数量与百分比">
                {statistics.genres.map((genre, index) => (
                  <li key={genre.name}>
                    <i aria-hidden="true" style={{ background: colors[index % colors.length] }} />
                    <span>{genre.name}</span>
                    <strong>
                      {genre.count} 部 · {percent(genre.percentage)}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="statistics-panel" aria-labelledby="year-chart-title">
          <h2 id="year-chart-title">历年首次聆听的作品数量</h2>
          <p className="muted small">按录入的最早已知完整聆听日期归年，每部作品只计一次。</p>
          {!statistics.years.length ? (
            <ChartEmpty>
              {statistics.completed
                ? '已有完整聆听记录，尚无可归入年份的日期。可以在作品详情补录历史日期。'
                : undefined}
            </ChartEmpty>
          ) : (
            <div
              className="year-chart-scroll"
              tabIndex={0}
              role="region"
              aria-label="历年首次完整聆听柱状图，可横向滚动"
            >
              <div className="year-axis-label">首次完整聆听作品数（部）</div>
              <ul className="year-bars">
                {statistics.years.map((row) => (
                  <li key={row.year} aria-label={`${row.year}年：${row.count}部`}>
                    <div className="year-bar-track">
                      <div
                        className="year-bar"
                        style={{ height: `${(row.count / maxYearCount) * 100}%` }}
                      >
                        <span>{row.count}</span>
                      </div>
                    </div>
                    <span className="year-label">{row.year}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="unknown-dates" data-testid="statistics-unknown">
            日期不详 / 未录入有效日期：{statistics.unknownDateCount} 部
          </p>
        </section>
      </div>
      <p className="archive-note">
        统计仅包含当前目录中符合既有可统计规则的独立作品，以稳定作品 ID
        去重。部分听过、乐章、作品集容器及不可统计条目不计入完整听过或覆盖率。删除最后一条日期仍保留完整听过状态，转入日期不详；日期不详与已知日期并存时，按最早已知年份统计。年份图仅显示有记录的年份。
      </p>
    </section>
  );
}
