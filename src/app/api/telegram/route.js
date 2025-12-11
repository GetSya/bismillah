import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { createClient } from '@supabase/supabase-js';

// ==================================================================
// 1. CONFIGURATION
// ==================================================================
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// ID Admin untuk Forward Chat (Wajib diisi di Environment Variable Vercel: ADMIN_ID)
const ADMIN_ID = process.env.ADMIN_ID;

const ADMIN_REKENING = { bank: "BCA", no: "123456789", name: "Admin Store" };

// ==================================================================
// 2. HELPER: KEYBOARD DINAMIS
// ==================================================================
function generateKeyboard(totalItems: number) {
    const topRow = [{ text: "🏷 List Produk" }, { text: "🛍 Voucher" }, { text: "📦 Laporan Stok" }];
    const bottomRow = [{ text: "💰 Deposit" }, { text: "❓ Cara" }, { text: "⚠️ Information" }];

    const numberGrid = [];
    if (totalItems > 0) {
        let currentRow = [];
        const maxButtons = Math.min(totalItems, 50); // Limit 50 agar tidak error

        for (let i = 1; i <= maxButtons; i++) {
            currentRow.push({ text: \`\${i}\` });
            if (currentRow.length === 6) {
                numberGrid.push(currentRow);
                currentRow = [];
            }
        }
        if (currentRow.length > 0) numberGrid.push(currentRow);
    }

    return {
        keyboard: [topRow, ...numberGrid, bottomRow],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "Pilih menu..."
    };
}

// ==================================================================
// 3. MAIN ROUTE HANDLER
// ==================================================================
export async function POST(req: Request) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' }, { status: 500 });

    try {
        const update = await req.json();

        if (update.message?.text) {
            await handleTextMessage(update.message);
        } else if (update.message?.photo) {
            await handlePhotoMessage(update.message);
        } else if (update.callback_query) {
             // Handle jika ada inline button (opsional)
             await bot.answerCallbackQuery(update.callback_query.id);
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('SERVER ERROR:', error);
        return NextResponse.json({ ok: true }); 
    }
}

// ==================================================================
// 4. LOGIC HANDLERS
// ==================================================================

async function handleTextMessage(msg: any) {
    if(!bot) return;
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;
    const firstName = user.first_name || 'Kak';

    // Sync User ke Database
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: \`\${user.first_name || ''} \${user.last_name || ''}\`.trim()
    });

    // ----------------------------------------------------
    // CASE A: User Klik Angka (Membeli Produk)
    // ----------------------------------------------------
    if (/^\\d+$/.test(text)) {
        const selectedNumber = parseInt(text);
        await handleProductSelection(chatId, selectedNumber);
        return; 
    }

    // ----------------------------------------------------
    // CASE B: Navigasi Menu
    // ----------------------------------------------------
    // Hitung jumlah produk aktif untuk keyboard
    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true);
    const totalProducts = count || 0;
    const dynamicMarkup = generateKeyboard(totalProducts);

    switch (text) {
        case '/start':
            await bot.sendMessage(chatId, \`👋 <b>Halo, \${firstName}!</b>\\n\\nSelamat datang di Store kami.\\nJumlah Produk Ready: <b>\${totalProducts} Item</b>\\nSilakan pilih menu di bawah.\`, {
                parse_mode: 'HTML',
                reply_markup: dynamicMarkup
            });
            break;

        case '🏷 List Produk':
            await showProductList(chatId, dynamicMarkup);
            break;
        
        case '🛍 Voucher':
            await bot.sendMessage(chatId, "Voucher sedang kosong.", { reply_markup: dynamicMarkup });
            break;
            
        case '📦 Laporan Stok':
             await bot.sendMessage(chatId, \`📊 <b>Status Stok:</b>\\n\\n🟢 Total Produk Aktif: \${totalProducts}\\n⚪ Produk Non-Aktif: (Sesuai DB)\\n\\n<i>Stok selalu update real-time.</i>\`, { parse_mode: 'HTML', reply_markup: dynamicMarkup });
             break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, "Fitur deposit hubungi Admin.", { reply_markup: dynamicMarkup });
            break;

        case '❓ Cara':
            await bot.sendMessage(chatId, "📚 <b>Cara Order:</b>\\n1. Klik menu 'List Produk'\\n2. Lihat nomor produk\\n3. Tekan angka di keyboard\\n4. Transfer & kirim bukti.", { parse_mode: 'HTML', reply_markup: dynamicMarkup });
            break;

        default:
             // ----------------------------------------------------
             // CASE C: LIVE CHAT & FORWARDING (Jika tidak ada match menu)
             // ----------------------------------------------------
             
             // 1. Simpan ke Database (Supabase) untuk Web Admin Panel
             let { data: room } = await supabase.from('chat_rooms').select('id').eq('user_id', chatId).single();
             if (!room) {
                  const { data: newRoom } = await supabase.from('chat_rooms').insert({ user_id: chatId }).select().single();
                  room = newRoom;
             }
 
             if (room) {
                  await supabase.from('chat_messages').insert({
                      room_id: room.id,
                      is_admin: false, // Pesan dari User
                      message_type: 'text',
                      content: text,
                      is_read: false
                  });
             }
 
             // 2. Forward Pesan ke Telegram Admin (@chenxiamomo / ADMIN_ID)
             if (ADMIN_ID && String(chatId) !== String(ADMIN_ID)) {
                 const forwardText = \`📩 <b>Pesan dari Pelanggan</b>\n👤 <b>User:</b> \${user.first_name} (@\${user.username || '-'})\n🆔 <b>ID:</b> <code>\${chatId}</code>\n\n💬 <b>Pesan:</b>\n\${text}\n\n<i>*Balas melalui Panel Admin atau Bot*</i>\`;
                 await bot.sendMessage(ADMIN_ID, forwardText, { parse_mode: 'HTML' });
             } else {
                 // Feedback ke user jika bukan admin yang test
                 // await bot.sendMessage(chatId, "Pesan terkirim ke admin. Mohon tunggu balasan.", { reply_markup: dynamicMarkup });
             }
             break;
    }
}

// ==========================================
// 📄 LOGIC TAMPILAN LIST (SYNC DENGAN NOMOR)
// ==========================================
async function showProductList(chatId: number | string, markupKeyboard: any) {
    if(!bot) return;
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) // SAMA DENGAN LOGIC SELECTION
        .limit(50);

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "🙏 Mohon maaf, produk sedang kosong.", { reply_markup: markupKeyboard });
    }

    let message = \`🛒 <b>DAFTAR PRODUK (\${products.length} Item)</b>\\n\`;
    message += \`<i>Klik nomor di tombol bawah sesuai produk:</i>\\n\\n\`;

    products.forEach((p, index) => {
        const num = index + 1; 
        const price = new Intl.NumberFormat('id-ID').format(p.price);
        message += \`<b>[\${num}] \${p.name.toUpperCase()}</b>\\n\`;
        message += \`   └ Rp \${price}\\n\\n\`;
    });

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: markupKeyboard
    });
}

// ==========================================
// 🛒 LOGIC PROSES BELI
// ==========================================
async function handleProductSelection(chatId: number | string, num: number) {
    if(!bot) return;
    
    // 1. Ambil Data Lagi (Urutan harus SAMA PERSIS dengan showProductList)
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) 
        .limit(50);
    
    const index = num - 1; 

    // Refresh keyboard count
    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true);
    const dynamicMarkup = generateKeyboard(count || 0);

    // Validasi
    if (!products || !products[index]) {
        return bot.sendMessage(chatId, \`⚠️ <b>Produk [\${num}] tidak ditemukan.</b>\\nMungkin urutan stok berubah. Silakan klik 'List Produk' lagi.\`, {
            parse_mode: 'HTML',
            reply_markup: dynamicMarkup
        });
    }

    const p = products[index];
    const price = new Intl.NumberFormat('id-ID').format(p.price);

    // Proses Invoice (Buat Order Pending)
    const { data: order, error } = await supabase.from('orders').insert({
        user_id: chatId,
        product_id: p.id,
        total_price: p.price,
        status: 'pending'
    }).select().single();

    if(error) return bot.sendMessage(chatId, "❌ Gagal membuat order. Coba lagi.");

    const text = \`🧾 <b>INVOICE #\${order.id}</b>\\n\\n📦 <b>\${p.name}</b>\\n💰 <b>Rp \${price}</b>\\n\\nSilakan transfer ke <b>\${ADMIN_REKENING.bank}</b>\\nNo: <code>\${ADMIN_REKENING.no}</code>\\nA.N \${ADMIN_REKENING.name}\\n\\n📸 <b>Lalu kirim bukti foto disini.</b>\`;
    
    // Kirim Invoice (Keyboard tetap nempel)
    await bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: dynamicMarkup 
    });
}

async function handlePhotoMessage(msg: any) {
    if(!bot) return;
    const chatId = msg.chat.id;
    const user = msg.from;
    
    // Cek apakah ada Order Pending dari user ini?
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (order) {
        // --- CASE 1: BUKTI BAYAR ---
        const waitMsg = await bot.sendMessage(chatId, "⏳ Sedang mengunggah bukti...");
        try {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const fileLink = await bot.getFileLink(fileId);
            const res = await fetch(fileLink);
            const blob = await res.blob();

            // Upload ke Catbox (Gratis & Permanent untuk demo)
            const formData = new FormData();
            formData.append('reqtype', 'fileupload');
            formData.append('fileToUpload', blob, \`proof_\${order.id}.jpg\`);

            const catboxRes = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: formData });
            if (!catboxRes.ok) throw new Error("Catbox Failed");
            const proofUrl = await catboxRes.text();

            // Update Order jadi Verification
            await supabase.from('orders').update({
                status: 'verification',
                payment_proof_url: proofUrl
            }).eq('id', order.id);

            await bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
            await bot.sendMessage(chatId, \`✅ <b>Bukti Diterima!</b>\\nOrder #\${order.id} sedang diverifikasi admin.\`, { parse_mode: 'HTML' });

            // Notif ke Admin
            if (ADMIN_ID) {
                await bot.sendMessage(ADMIN_ID, \`🔔 <b>Bukti Transfer Baru</b>\\nOrder #\${order.id}\\nUser: \${chatId}\\nURL: \${proofUrl}\`, { parse_mode: 'HTML' });
            }
        } catch (e) {
            console.error("Upload Error:", e);
            await bot.sendMessage(chatId, "❌ Gagal mengunggah bukti.");
        }
    } else {
        // --- CASE 2: LIVE CHAT FOTO (FORWARD KE ADMIN) ---
        if (ADMIN_ID && String(chatId) !== String(ADMIN_ID)) {
             const fileId = msg.photo[msg.photo.length - 1].file_id;
             await bot.sendPhoto(ADMIN_ID, fileId, { caption: \`📸 <b>Foto dari User</b>\n\${user.first_name} (@\${user.username || '-'}) - \${chatId}\`, parse_mode: 'HTML' });
             await bot.sendMessage(chatId, "📸 Foto terkirim ke admin.");
        }
    }
}
