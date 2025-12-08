import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==================================================================
// 🧱 1. CONFIGURATION
// ==================================================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Info Rekening Transfer (Tampil di Invoice)
const BANK_INFO = {
    bank: "BCA",
    number: "1234-5678-9000",
    name: "STORE OFFICIAL"
};

// Pengaturan Tampilan Tombol Angka
const MAX_BUTTONS_DISPLAY = 50;  // Batas Maksimal Produk yang muncul tombol
const BUTTONS_PER_ROW = 6;       // 6 Kotak per baris (Rapi seperti Grid)

// ==================================================================
// 🎹 2. HELPER: MEMBUAT KEYBOARD DINAMIS
// ==================================================================
function createDynamicKeyboard(totalItems) {
    // A. Baris Menu Atas (Fixed)
    const topMenu = [
        { text: "🏷 List Produk" }, { text: "🛍 Voucher" }, { text: "📦 Laporan Stok" }
    ];

    // B. Baris Menu Bawah (Fixed)
    const bottomMenu = [
        { text: "💰 Deposit" }, { text: "❓ Cara" }, { text: "⚠️ Information" }
    ];

    // C. Baris Angka (Dinamis sesuai Jumlah Produk)
    const numberGrid = [];
    const count = Math.min(totalItems, MAX_BUTTONS_DISPLAY); // Safety Limit

    if (count > 0) {
        let tempRow = [];
        for (let i = 1; i <= count; i++) {
            tempRow.push({ text: `${i}` });

            // Dorong ke grid jika sudah genap 6 kolom
            if (tempRow.length === BUTTONS_PER_ROW) {
                numberGrid.push(tempRow);
                tempRow = [];
            }
        }
        // Masukkan sisa tombol baris terakhir
        if (tempRow.length > 0) {
            numberGrid.push(tempRow);
        }
    }

    return {
        keyboard: [
            topMenu,
            ...numberGrid,
            bottomMenu
        ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "Pilih menu atau nomor produk..."
    };
}


// ==================================================================
// 🚀 3. MAIN ROUTE HANDLER
// ==================================================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' });

    try {
        const body = await req.json();

        // ROUTER: Mengarahkan pesan ke Function yang tepat

        // 1. Jika User Klik Tombol Inline (Checkout / Batal)
        if (body.callback_query) {
            await handleCallbackQuery(body.callback_query);
        }
        // 2. Jika User Kirim Pesan Teks (Menu Utama / Angka Keyboard)
        else if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        // 3. Jika User Kirim Foto (Bukti Transfer)
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('SYSTEM ERROR:', error);
        return NextResponse.json({ error: error.message });
    }
}


// ==================================================================
// 🕹️ 4. LOGIC TOMBOL CHECKOUT & BATAL (CALLBACK QUERY)
// ==================================================================
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Stop Loading di Tombol User
    await bot.answerCallbackQuery(query.id);

    // CASE: BATAL
    if (data === 'cancel') {
        // Hapus pesan detail produk
        await bot.deleteMessage(chatId, messageId);
        // (Optional) Info pesan terhapus
        // await bot.sendMessage(chatId, "❌ Dibatalkan.");
    }
    // CASE: CHECKOUT
    else if (data.startsWith('checkout_')) {
        const productId = data.split('_')[1];

        // 1. Validasi Produk
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) {
            return bot.sendMessage(chatId, "⚠️ Produk tidak ditemukan.");
        }

        // 2. Create Order (Status: PENDING)
        // Belum 'verification' karena belum bayar
        const { data: order, error } = await supabase.from('orders').insert({
            user_id: chatId,
            product_id: productId,
            total_price: product.price,
            status: 'pending' // Awal transaksi
        }).select().single();

        if (error) {
            console.error(error);
            return bot.sendMessage(chatId, "❌ Gagal membuat pesanan.");
        }

        const price = new Intl.NumberFormat('id-ID').format(product.price);

        // 3. Update Tampilan Pesan Jadi Invoice
        const invoiceMsg = `
⚡️ <b>ORDER BERHASIL DIBUAT! (#${order.id})</b>
────────────────────
📦 <b>Item:</b> ${product.name}
💰 <b>Harga:</b> Rp ${price}
────────────────────

🏦 <b>SILAKAN TRANSFER:</b>
<b>${BANK_INFO.bank}</b>
<code>${BANK_INFO.number}</code>
A.N ${BANK_INFO.name}

📸 <b>STATUS: 🟡 PENDING</b>
Mohon segera kirim <b>FOTO BUKTI TRANSFER</b> ke sini agar diproses ke tahap verifikasi.
`;

        await bot.editMessageText(invoiceMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
    }
}


// ==================================================================
// 💬 5. LOGIC PESAN TEKS (MENU & PILIH NOMOR)
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // 1. Simpan Data User
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: `${user.first_name} ${user.last_name || ''}`.trim()
    });

    // 2. Hitung Stok (Agar Keyboard Sinkron)
    // Penting: Hitung produk yang ACTIVE saja
    const { count } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const totalProducts = count || 0;
    const keyboardMarkup = createDynamicKeyboard(totalProducts);

    // 3. Cek apakah user menekan ANGKA (1, 2, 3...)?
    if (/^\d+$/.test(text)) {
        // Masuk Logic Menampilkan Detail Produk
        await showProductDetail(chatId, parseInt(text), keyboardMarkup);
        return; 
    }

    // 4. Logic Menu Navigasi
    switch (text) {
        case '/start':
            const welcomeMsg = `
👋 <b>Halo, ${user.first_name}!</b>
Selamat datang di Store Bot Otomatis.

Silakan pilih <b>🏷 List Produk</b> untuk melihat katalog, 
lalu gunakan Tombol Angka untuk memilih barang.
`;
            await bot.sendMessage(chatId, welcomeMsg, { 
                parse_mode: 'HTML', 
                reply_markup: keyboardMarkup 
            });
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, keyboardMarkup);
            break;

        case '🛍 Voucher':
            await bot.sendMessage(chatId, "🔐 Menu Voucher sedang maintenance.", { 
                reply_markup: keyboardMarkup 
            });
            break;

        case '📦 Laporan Stok':
            const report = `
📊 <b>LAPORAN STOK</b>
──────────────────
📦 Ready: <b>${totalProducts} Item</b>
✅ Status System: <b>Online</b>
──────────────────
`;
            await bot.sendMessage(chatId, report, { 
                parse_mode: 'HTML', 
                reply_markup: keyboardMarkup 
            });
            break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, "Silakan chat admin @AdminStore untuk deposit manual.", { 
                reply_markup: keyboardMarkup 
            });
            break;
            
        case '❓ Cara':
            const guide = `
📚 <b>CARA ORDER:</b>
1. Klik Menu 🏷 List Produk
2. Cek nomor di samping nama produk
3. Klik tombol angka yang sesuai (Misal [1])
4. Baca Detail & Klik Checkout
5. Transfer & Kirim Bukti di chat ini.
            `;
            await bot.sendMessage(chatId, guide, { parse_mode: 'HTML', reply_markup: keyboardMarkup });
            break;

        case '⚠️ Information':
            await bot.sendMessage(chatId, "Store Buka 24 Jam Non-stop.", { reply_markup: keyboardMarkup });
            break;

        default:
            // Jangan spam error, cukup pancing keyboard keluar lagi
            await bot.sendMessage(chatId, "Silakan pilih menu.", { reply_markup: keyboardMarkup });
            break;
    }
}


// ==================================================================
// 📝 6. HELPER FUNCTIONS: LIST & DETAIL
// ==================================================================

// A. MENAMPILKAN LIST PRODUK
async function sendProductList(chatId, replyMarkup) {
    // WAJIB URUT PRICE ASC agar indeks konsisten dengan Detail
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) 
        .limit(MAX_BUTTONS_DISPLAY);

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "⚠️ Produk Kosong.", { reply_markup: replyMarkup });
    }

    let msg = `🛒 <b>DAFTAR PRODUK RESMI</b>\n\n`;
    
    products.forEach((p, idx) => {
        const num = idx + 1;
        const price = new Intl.NumberFormat('id-ID').format(p.price);
        msg += `[${num}] <b>${p.name.toUpperCase()}</b>\n   Rp ${price}\n\n`;
    });

    msg += `👇 <i>Pilih dengan menekan tombol angka di bawah</i>`;

    await bot.sendMessage(chatId, msg, { 
        parse_mode: 'HTML', 
        reply_markup: replyMarkup 
    });
}

// B. MENAMPILKAN DETAIL PRODUK SEBELUM CHECKOUT
async function showProductDetail(chatId, selectedNumber, mainKeyboard) {
    // 1. Ambil data (Logika Index SAMA dengan List)
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true })
        .limit(MAX_BUTTONS_DISPLAY);
    
    const index = selectedNumber - 1; // Array Index 0 based

    // Validasi Nomor
    if (!products || !products[index]) {
        return bot.sendMessage(chatId, `⚠️ Produk No [${selectedNumber}] tidak ditemukan/sudah habis. Silakan refresh list.`, {
            reply_markup: mainKeyboard
        });
    }

    const item = products[index];
    const price = new Intl.NumberFormat('id-ID').format(item.price);

    // Isi Pesan Detail
    const detailMsg = `
🔍 <b>DETAIL PRODUK</b>
➖➖➖➖➖➖➖➖➖➖
🏷 <b>${item.name.toUpperCase()}</b>
💰 <b>Rp ${price}</b>
➖➖➖➖➖➖➖➖➖➖

📄 <b>Deskripsi:</b>
${item.description || "- Tidak ada deskripsi khusus -"}

<i>Apakah Anda ingin membeli produk ini?</i>
    `;

    // 2. Tampilkan Tombol Action (Checkout / Batal)
    const actionKeyboard = {
        inline_keyboard: [
            [
                { text: "✅ Checkout Langsung", callback_data: `checkout_${item.id}` }
            ],
            [
                { text: "🏠 Kembali / Batal", callback_data: `cancel` } 
            ]
        ]
    };

    // Kirim pesan detail, TAPI TETAPKAN keyboard angka di bawahnya (optionl)
    // Pada library node-telegram-bot-api, kita mengirim 2 pesan berbeda: pesan teks (dg inline btn) dan update keyboard utama
    await bot.sendMessage(chatId, detailMsg, {
        parse_mode: 'HTML',
        reply_markup: actionKeyboard 
    });
}


// ==================================================================
// 📸 7. HANDLE FOTO (UPLOAD BUKTI)
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // 1. Cari Pesanan user ini yang statusnya 'pending' (Menunggu bayar)
    // Ambil yang paling baru dibuat (desc)
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending') 
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    // Jika tidak ada order pending, tolak foto
    if (!order) {
        return bot.sendMessage(chatId, "⚠️ <b>Tidak ada tagihan aktif.</b>\nSilakan pilih produk & Checkout dulu sebelum kirim bukti.", {parse_mode:'HTML'});
    }

    const loadingMsg = await bot.sendMessage(chatId, "⏳ <i>Mengupload bukti ke server...</i>", {parse_mode:'HTML'});

    try {
        // 2. Ambil Link & Buffer Gambar
        const photo = msg.photo[msg.photo.length - 1]; // Kualitas tertinggi
        const fileUrl = await bot.getFileLink(photo.file_id);
        const imgResponse = await fetch(fileUrl);
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer); // ✅ Ubah ke Buffer (Wajib untuk Supabase + Node)
        
        // 3. Nama File Unik
        const filename = `proof_${order.id}_${Date.now()}.jpg`;

        // 4. Upload ke Bucket: 'payment-proofs'
        // Upsert: true untuk replace jika ada duplikat nama
        const { error: uploadError } = await supabase.storage
            .from('payment-proofs')
            .upload(filename, buffer, { 
                contentType: 'image/jpeg',
                upsert: true 
            });
        
        if (uploadError) throw uploadError;

        // 5. Get Public URL
        const { data: urlData } = supabase.storage
            .from('payment-proofs')
            .getPublicUrl(filename);
        
        // 6. UPDATE DB: Ubah Status jadi 'verification'
        await supabase.from('orders').update({
            status: 'verification', 
            payment_proof_url: urlData.publicUrl
        }).eq('id', order.id);

        // 7. Done
        await bot.deleteMessage(chatId, loadingMsg.message_id);

        await bot.sendMessage(chatId, `
✅ <b>STATUS UPDATE: 🔵 VERIFICATION</b>
──────────────────────
Order: <b>#${order.id}</b>
Item: ${order.products?.name}

👮‍♂️ <b>Terima kasih!</b>
Admin akan segera memverifikasi bukti Anda. Produk/Voucher akan dikirim otomatis ke sini jika sudah 🟢 Success.
`, { parse_mode: 'HTML' });

    } catch (e) {
        console.error("Upload Failed:", e);
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendMessage(chatId, "❌ Gagal upload bukti. Mohon coba kirim ulang gambar.");
    }
}