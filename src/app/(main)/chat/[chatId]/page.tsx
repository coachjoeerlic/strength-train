export default function ChatPage({ params }: { params: { chatId: string } }) {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 p-4">
        <h1 className="text-2xl font-bold mb-6">Chat {params.chatId}</h1>
        {/* Chat messages will go here */}
      </div>
    </main>
  );
} 