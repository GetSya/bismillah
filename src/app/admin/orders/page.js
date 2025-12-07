'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import styles from '../admin.module.css';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null); // Untuk popup proses
  const [credentials, setCredentials] = useState(''); // Input akun email:pass
  const [loading, setLoading] = useState(false);

  // Fetch Order + Relasi ke Products & Users
  async function fetchOrders() {
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        products (name),
        users (username, full_name)
      `)
      .order('created_at', { ascending: false });
    setOrders(data || []);
  }

  useEffect(() => { fetchOrders(); }, []);

  // Fungsi Proses Order
  // Fungsi Proses Order (REVISI)
  async function processOrder() {
    if (!credentials) return alert('Mohon isi data akun/voucher!');
    setLoading(true);

    try {
      console.log('Sending data:', {
        orderId: selectedOrder.id,
        telegramId: selectedOrder.user_id,
        accountCredentials: credentials // Cek di console browser apakah ini ada isinya
      });

      const res = await fetch('/api/admin/complete-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          telegramId: selectedOrder.user_id, // Pastikan kolom database Anda: user_id
          accountCredentials: credentials
        })
      });

      const result = await res.json();

      if (res.ok && result.success) {
        alert('✅ Sukses! Order selesai.');
        setSelectedOrder(null);
        setCredentials('');
        fetchOrders();
      } else {
        // Tampilkan pesan error spesifik dari server
        alert(`❌ Gagal: ${result.error || 'Terjadi kesalahan sistem'}`);
      }
    } catch (e) {
      console.error(e);
      alert('❌ Error Koneksi: Cek console browser Anda.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className={styles.header}>Daftar Pesanan</h1>

      {/* Bagian Popup Proses Order (Tampil jika ada order dipilih) */}
      {selectedOrder && (
        <div style={{
          position: 'fixed', top:0, left:0, right:0, bottom:0, 
          background: 'rgba(0,0,0,0.7)', display:'flex', justifyContent:'center', alignItems:'center' 
        }}>
          <div className={styles.card} style={{width: '400px', maxHeight: '90vh', overflowY: 'auto'}}>
            <h3>Proses Order #{selectedOrder.id}</h3>
            <p>User: @{selectedOrder.users?.username}</p>
            <p>Item: {selectedOrder.products?.name}</p>
            
            <hr style={{margin: '15px 0', border: '0', borderTop: '1px solid #eee'}} />

            <h4>Bukti Transfer:</h4>
            {selectedOrder.payment_proof_url ? (
               <a href={selectedOrder.payment_proof_url} target="_blank">
                 <img src={selectedOrder.payment_proof_url} style={{width: '100%', borderRadius: '5px', border:'1px solid #ddd'}} />
               </a>
            ) : (
               <p style={{color:'red'}}>Belum ada bukti transfer</p>
            )}

            <hr style={{margin: '15px 0', border: '0', borderTop: '1px solid #eee'}} />
            
            <h4>Data Akun / Voucher (Dikirim ke User):</h4>
            <textarea 
              className={styles.textarea} 
              rows="4" 
              placeholder="Contoh: email: user@mail.com | pass: 123456"
              value={credentials}
              onChange={(e) => setCredentials(e.target.value)}
            />
            
            <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
              <button className={styles.btn} onClick={processOrder} disabled={loading}>
                {loading ? 'Mengirim...' : '✅ Kirim & Selesai'}
              </button>
              <button className={`${styles.btn} ${styles.btnRed}`} onClick={() => setSelectedOrder(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabel Orders */}
      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Produk</th>
              <th>Status</th>
              <th>Bukti</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>#{o.id}</td>
                <td>{o.users?.full_name}<br/><small>@{o.users?.username}</small></td>
                <td>{o.products?.name}<br/><b>Rp {o.total_price?.toLocaleString()}</b></td>
                <td>
                  <span className={`${styles.badge} ${
                    o.status === 'pending' ? styles['badge-pending'] : 
                    o.status === 'paid' ? styles['badge-paid'] : styles['badge-completed']
                  }`}>
                    {o.status.toUpperCase()}
                  </span>
                </td>
                <td>
                  {o.payment_proof_url ? (
                    <a href={o.payment_proof_url} target="_blank" style={{color: 'blue', textDecoration:'underline'}}>Lihat Foto</a>
                  ) : '-'}
                </td>
                <td>
                  {o.status !== 'completed' && (
                    <button className={styles.btn} onClick={() => setSelectedOrder(o)} style={{padding: '5px 10px', fontSize: '12px'}}>
                      Proses
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}