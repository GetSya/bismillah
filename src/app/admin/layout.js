import styles from './admin.module.css';
import Link from 'next/link';

export default function AdminLayout({ children }) {
  return (
    <div className={styles.container}>
      <nav className={styles.sidebar}>
        <h2>Admin Panel 🚀</h2>
        <Link href="/admin">📊 Dashboard</Link>
        <Link href="/admin/products">📦 Produk</Link>
        <Link href="/admin/orders">🛒 Pesanan</Link>
        <div style={{marginTop: 'auto', fontSize: '12px', color: '#7f8c8d'}}>
          Marketplace Bot v1.0
        </div>
      </nav>
      <main className={styles.content}>
        {children}
      </main>
    </div>
  );
}