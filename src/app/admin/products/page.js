'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import styles from '../admin.module.css';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);

  // State Form
  const [form, setForm] = useState({ name: '', price: '', unit: '', description: '', software_type: '' });

  // 1. Fetch Produk
  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*').order('id', { ascending: false });
    setProducts(data || []);
  }

  useEffect(() => { fetchProducts(); }, []);

  // 2. Handle Submit (Bisa Simpan Baru / Update)
  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);

    try {
        if (isEditing) {
            // --- LOGIKA UPDATE ---
            const { error } = await supabase
                .from('products')
                .update(form)
                .eq('id', editId);
            
            if (error) throw error;
            alert('✅ Produk berhasil diupdate!');
        } else {
            // --- LOGIKA INSERT BARU ---
            const { error } = await supabase
                .from('products')
                .insert([form]);

            if (error) throw error;
            alert('✅ Produk baru ditambahkan!');
        }

        // Reset Form
        setForm({ name: '', price: '', unit: '', description: '', software_type: '' });
        setIsEditing(false);
        setEditId(null);
        fetchProducts(); // Refresh tabel

    } catch (error) {
        console.error(error);
        alert('Gagal menyimpan data: ' + error.message);
    } finally {
        setLoading(false);
    }
  }

  // 3. Tombol Edit Diklik
  function handleEditClick(product) {
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll ke atas
    setIsEditing(true);
    setEditId(product.id);
    setForm({
        name: product.name,
        price: product.price,
        unit: product.unit,
        description: product.description || '',
        software_type: product.software_type || ''
    });
  }

  // 4. Tombol Batal
  function handleCancel() {
    setIsEditing(false);
    setEditId(null);
    setForm({ name: '', price: '', unit: '', description: '', software_type: '' });
  }

  // 5. Hapus Produk
  async function handleDelete(id) {
    if(confirm('⚠️ Yakin hapus produk ini permanen?')) {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) {
        alert("Gagal menghapus: " + error.message);
      } else {
        fetchProducts();
      }
    }
  }

  return (
    <div>
      <h1 className={styles.header}>Manajemen Produk</h1>

      {/* --- FORM CARD --- */}
      <div className={styles.card} style={isEditing ? {border: '2px solid #f39c12'} : {}}>
        <div style={{display:'flex', justifyContent:'space-between'}}>
            <h3>{isEditing ? `✏️ Edit Produk (ID: ${editId})` : '➕ Tambah Produk Baru'}</h3>
            {isEditing && <button onClick={handleCancel} className={styles.btnRed} style={{fontSize:'12px'}}>Batal Edit</button>}
        </div>

        <form onSubmit={handleSubmit}>
          <input 
            className={styles.input} 
            placeholder="Nama Produk (ex: Spotify Premium)" 
            value={form.name} 
            onChange={e => setForm({...form, name: e.target.value})} 
            required 
          />
          <div style={{display:'flex', gap:'10px'}}>
             <input 
                className={styles.input} 
                type="number" 
                placeholder="Harga (Angka)" 
                value={form.price} 
                onChange={e => setForm({...form, price: e.target.value})} 
                required 
             />
             <input 
                className={styles.input} 
                placeholder="Satuan (ex: 1 Bulan / Akun)" 
                value={form.unit} 
                onChange={e => setForm({...form, unit: e.target.value})} 
                required 
             />
          </div>
          <input 
            className={styles.input} 
            placeholder="Kategori (ex: Streaming, VPN, Music)" 
            value={form.software_type} 
            onChange={e => setForm({...form, software_type: e.target.value})} 
          />
          <textarea 
            className={styles.textarea} 
            placeholder="Deskripsi Singkat Fitur Produk" 
            value={form.description} 
            onChange={e => setForm({...form, description: e.target.value})} 
          />
          
          <button type="submit" className={styles.btn} disabled={loading} 
            style={isEditing ? {background: '#f39c12'} : {}}
          >
            {loading ? 'Menyimpan...' : (isEditing ? '💾 Update Produk' : '+ Simpan Produk')}
          </button>
        </form>
      </div>

      {/* --- LIST TABLE --- */}
      <div className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Nama Item</th>
              <th>Harga</th>
              <th>Kategori</th>
              <th style={{textAlign:'center'}}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
                <tr><td colSpan="4" style={{textAlign:'center'}}>Belum ada produk data.</td></tr>
            )}
            {products.map((p) => (
              <tr key={p.id} style={{background: isEditing && editId === p.id ? '#fff3cd' : 'transparent'}}>
                <td>
                    <b>{p.name}</b><br/>
                    <small style={{color:'#7f8c8d'}}>{p.unit}</small>
                </td>
                <td>Rp {parseInt(p.price).toLocaleString('id-ID')}</td>
                <td><span style={{background:'#ecf0f1', padding:'3px 8px', borderRadius:'4px', fontSize:'12px'}}>{p.software_type}</span></td>
                <td style={{textAlign:'center'}}>
                  <div style={{display:'flex', gap:'5px', justifyContent:'center'}}>
                    <button 
                        onClick={() => handleEditClick(p)} 
                        className={styles.btn} 
                        style={{background:'#f39c12', padding: '5px 10px', fontSize:'12px'}}>
                        Edit
                    </button>
                    <button 
                        onClick={() => handleDelete(p.id)} 
                        className={`${styles.btn} ${styles.btnRed}`} 
                        style={{padding: '5px 10px', fontSize:'12px'}}>
                        Hapus
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}