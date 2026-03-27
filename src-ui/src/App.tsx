import { useState } from "react";
import { Library } from "./ui/Library";
import { WriterLayout } from "./ui/writer/WriterLayout";

function App() {
  const [currentPage, setCurrentPage] = useState<string>("library");

  return (
    <>
      {currentPage === "library" ? (
         <Library onNavigate={setCurrentPage} />
      ) : (
         <WriterLayout onNavigate={setCurrentPage} />
      )}
    </>
  );
}

export default App;
