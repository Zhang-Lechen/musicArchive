import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title">
      <p className="eyebrow">404</p>
      <h1 id="not-found-title">页面不存在</h1>
      <p className="page-intro">请检查地址，或返回首页。</p>
      <Link className="back-link" to="/">
        返回首页
      </Link>
    </section>
  );
}
