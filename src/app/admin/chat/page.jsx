'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase' // Pastikan path benar

// Ganti 123 dengan ID Room yang sedang dibuka admin
const ROOM_ID_TO_WATCH = 1; 

export default function AdminChat() {
  const [messages, setMessages] = useState([]);

  // 1. Fetch pesan awal
  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('room_id', ROOM_ID_TO_WATCH)
        .order('created_at', { ascending: true });
      
      if (data) setMessages(data);
    };
    fetchMessages();
  }, []);

  // 2. Subscribe ke Realtime (Live Chat)
  useEffect(() => {
    const channel = supabase
      .channel('chat_live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${ROOM_ID_TO_WATCH}`,
        },
        (payload) => {
          console.log('Pesan baru masuk live:', payload.new);
          // Tambahkan pesan baru ke state agar muncul di layar
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-5">
      <h1>Live Chat Monitor</h1>
      <div className="border p-4 h-96 overflow-y-auto">
        {messages.map((msg) => (
          <div key={msg.id} className={`mb-2 ${msg.is_admin ? 'text-right' : 'text-left'}`}>
            <span className={`inline-block p-2 rounded ${msg.is_admin ? 'bg-blue-200' : 'bg-gray-200'}`}>
              {msg.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
