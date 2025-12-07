'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import styles from '../admin.module.css';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: '', price: '', unit: '', description: '', software_type: '' });

  // 1. Fetch Produk
  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*').order('id', { ascending: false });
    setProducts(data || []);
  }

  useEffect(() => { fetchProducts(); }, []);

  // 2. Tambah Produk
  async function handleSubmit(e) {
    e.preventDefault();
    const { error } = await supabase.from('products').insert([form]);
    if (!error) {
      alert('Produk berhasil ditambahkan!');
      setForm({ name: '', price: '', unit: '', description: '', software_type: '' });
      fetchProducts();
    } else {
      alert('Gagal menambah produk');
    }
  }

  // 3. Hapus Produk
  async function handleDelete(id) {
    if(confirm('Yakin hapus?')) {
      await supabase.from('products').delete().eq('id', id);
      fetchProducts();
    }
  }

  return (
    <div>
      <h1 className={styles.header}>Manajemen Produk</h1>

      {/* Form Input */}
      <div className={styles.card}>
        <h3>Tambah Produk Baru</h3>
        <form onSubmit={handleSubmit}>
          <input className={styles.input} placeholder="Nama Produk (ex: Spotify)" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
          <div style={{display:'flex', gap:'10px'}}>
             <input className={styles.input} type="number" placeholder="Harga" value={form.price} onChange={e => setForm({...form, price: e.target.value})} required />
             <input className={styles.input} placeholder="Satuan (ex: 1 Bulan)" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} required />
          </div>
          <input className={styles.input} placeholder="Kategori (ex: Music, VPN)" value={form.software_type} onChange={e => setForm({...form, software_type: e.target.value})} />
          <textarea className={styles.textarea} placeholder="Deskripsi Singkat" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
          <button type="submit" className={styles.btn}>+ Simpan Produk</button>
        </form>
      </div>

      {/* Tabel List */}
      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Nama</th>
              <th>Harga</th>
              <th>Kategori</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b><br/><small>{p.unit}</small></td>
                <td>Rp {p.price.toLocaleString()}</td>
                <td>{p.software_type}</td>
                <td>
                  <button onClick={() => handleDelete(p.id)} className={`${styles.btn} ${styles.btnRed}`} style={{padding: '5px 10px', fontSize:'12px'}}>Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}