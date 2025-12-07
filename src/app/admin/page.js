'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './admin.module.css';

export default function Dashboard() {
  const [stats, setStats] = useState({ products: 0, orders: 0, income: 0 });

  useEffect(() => {
    async function fetchData() {
      // Hitung total produk
      const { count: productsCount } = await supabase.from('products').select('*', { count: 'exact' });
      
      // Hitung total order & income
      const { data: orders } = await supabase.from('orders').select('total_price, status');
      const income = orders
        .filter(o => o.status === 'completed' || o.status === 'paid')
        .reduce((sum, item) => sum + (item.total_price || 0), 0);

      setStats({
        products: productsCount,
        orders: orders.length,
        income: income
      });
    }
    fetchData();
  }, []);

  return (
    <div>
      <h1 className={styles.header}>Dashboard Overview</h1>
      <div className={styles.grid}>
        <div className={styles.card}>
          <h3>Total Penjualan</h3>
          <h1>Rp {stats.income.toLocaleString()}</h1>
        </div>
        <div className={styles.card}>
          <h3>Total Order</h3>
          <h1>{stats.orders}</h1>
        </div>
        <div className={styles.card}>
          <h3>Produk Aktif</h3>
          <h1>{stats.products}</h1>
        </div>
      </div>
    </div>
  );
}