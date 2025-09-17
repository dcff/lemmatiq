import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  writeBatch,
  doc,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  DocumentData,
  WhereFilterOp,
  QuerySnapshot,
  QueryConstraint,
  startAfter,
  getDoc,
  DocumentSnapshot,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {

  private app = initializeApp(environment.firebaseConfig);
  private db = getFirestore(this.app);

  async addDocument(database: string, data: any): Promise<string | undefined> {
    try {
      const docRef = await addDoc(collection(this.db, database), {
        ...data,
        createdAt: new Date()
      });

      console.log("Document written with ID: ", docRef.id);
      return docRef.id;
    } catch (error) {
      console.error("Error adding document: ", error);
      return undefined;
    }
  }

  /**
   * Upload CSV data to Firestore
   * @param collectionName The name of the Firestore collection to upload to
   * @param csvData Array of objects parsed from CSV file
   * @param addCreatedAt Whether to add a createdAt timestamp to each record
   * @returns Number of records successfully uploaded
   */
  async uploadCSVToFirestore(
    csvData: any[],
    collectionName: string = "logoi",
    addCreatedAt: boolean = true
  ): Promise<number> {
    if (!csvData || csvData.length === 0) {
      throw new Error('No CSV data provided');
    }

    try {
      // For small datasets, use individual addDoc calls
      if (csvData.length <= 20) {
        const collectionRef = collection(this.db, collectionName);
        let successCount = 0;

        for (const item of csvData) {
          const dataToAdd = addCreatedAt ? { ...item, createdAt: new Date() } : item;
          await addDoc(collectionRef, dataToAdd);
          successCount++;
        }

        console.log(`${successCount} records uploaded to Firestore collection: ${collectionName}`);
        return successCount;
      }
      // For larger datasets, use batched writes
      else {
        // Firestore supports max 500 operations per batch
        const batchSize = 500;
        let successCount = 0;

        // Process in batches of 500
        for (let i = 0; i < csvData.length; i += batchSize) {
          const batch = writeBatch(this.db);
          const currentBatch = csvData.slice(i, i + batchSize);

          currentBatch.forEach(item => {
            const collectionRef = collection(this.db, collectionName);
            const docRef = doc(collectionRef);
            const dataToAdd = addCreatedAt ? { ...item, createdAt: new Date() } : item;
            batch.set(docRef, dataToAdd);
          });

          await batch.commit();
          successCount += currentBatch.length;
          console.log(`Batch committed: ${i} to ${i + currentBatch.length}`);
        }

        console.log(`${successCount} records uploaded to Firestore collection: ${collectionName}`);
        return successCount;
      }
    } catch (error) {
      console.error('Error uploading CSV data to Firestore:', error);
      throw error;
    }
  }

  /**
     * Get a document by ID
     * @param collectionName The collection to query
     * @param docId The document ID
     * @returns The document data or null if not found
     */
  async getDocumentById(collectionName: string, docId: string): Promise<DocumentData | null> {
    try {
      const docRef = doc(this.db, collectionName, docId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
      } else {
        console.log("No such document!");
        return null;
      }
    } catch (error) {
      console.error("Error getting document:", error);
      throw error;
    }
  }

  /**
   * Update a document by ID
   * @param collectionName The collection containing the document
   * @param docId The document ID
   * @param data The data to update
   * @returns Promise that resolves when update is complete
   */
  async updateDocument(collectionName: string, docId: string, data: any): Promise<void> {
    try {
      const docRef = doc(this.db, collectionName, docId);
      await updateDoc(docRef, data);
      console.log("Document successfully updated");
    } catch (error) {
      console.error("Error updating document:", error);
      throw error;
    }
  }

  /**
   * Delete a document by ID
   * @param collectionName The collection containing the document
   * @param docId The document ID
   * @returns Promise that resolves when deletion is complete
   */
  async deleteDocument(collectionName: string, docId: string): Promise<void> {
    try {
      const docRef = doc(this.db, collectionName, docId);
      await deleteDoc(docRef);
      console.log("Document successfully deleted");
    } catch (error) {
      console.error("Error deleting document:", error);
      throw error;
    }
  }

  /**
   * Query documents with filters
   * @param collectionName The collection to query
   * @param filters Array of filter objects with field, operator, and value
   * @returns Array of documents matching the query
   */
  async queryDocuments(
    collectionName: string,
    filters: Array<{ field: string; operator: WhereFilterOp; value: any }> = [],
    sortField?: string,
    sortDirection: 'asc' | 'desc' = 'asc',
    limitCount?: number
  ): Promise<Array<DocumentData>> {
    try {
      const collectionRef = collection(this.db, collectionName);
      const constraints: QueryConstraint[] = [];

      // Add filter constraints
      filters.forEach(filter => {
        constraints.push(where(filter.field, filter.operator, filter.value));
      });

      // Add sort constraint if provided
      if (sortField) {
        constraints.push(orderBy(sortField, sortDirection));
      }

      // Add limit constraint if provided
      if (limitCount) {
        constraints.push(limit(limitCount));
      }

      const q = query(collectionRef, ...constraints);
      const querySnapshot = await getDocs(q);

      const results: DocumentData[] = [];
      querySnapshot.forEach((doc) => {
        results.push({ id: doc.id, ...doc.data() });
      });

      return results;
    } catch (error) {
      console.error("Error querying documents:", error);
      throw error;
    }
  }

  /**
   * Query words based on various criteria
   * @param searchText Optional text to search in word or translation fields
   * @param minScore Optional minimum score filter
   * @param maxResults Optional limit on number of results
   * @returns Array of word documents matching criteria
   */
  async queryWords(
    searchText?: string,
    minScore?: number,
    maxResults?: number
  ): Promise<Array<DocumentData>> {
    const filters: Array<{ field: string; operator: WhereFilterOp; value: any }> = [];

    if (searchText) {
      // For simple implementation, we're doing exact matches
      // For more complex text search, you might need a different approach or a third-party solution
      filters.push({ field: 'word', operator: '>=' as WhereFilterOp, value: searchText });
      filters.push({ field: 'word', operator: '<=' as WhereFilterOp, value: searchText + '\uf8ff' });
      filters.push({ field: 'score', operator: '>=' as WhereFilterOp, value: minScore });
    }

    if (minScore !== undefined) {
      filters.push({ field: 'score', operator: '>=', value: minScore });
    }

    return this.queryDocuments('logoi', filters, 'word', 'asc', maxResults);
  }

  /**
   * Pagination query with cursor-based pagination
   * @param collectionName The collection to query
   * @param lastDoc The last document from previous batch
   * @param pageSize Number of documents to fetch
   * @param filters Optional array of filters
   * @param sortField Optional field to sort by
   * @param sortDirection Sort direction, default ascending
   * @returns Object with documents and last document for next pagination
   */
  async paginatedQuery(
    collectionName: string,
    lastDoc: DocumentSnapshot | null,
    pageSize: number,
    filters: Array<{ field: string; operator: WhereFilterOp; value: any }> = [],
    sortField?: string,
    sortDirection: 'asc' | 'desc' = 'asc'
  ): Promise<{ docs: DocumentData[]; lastDoc: DocumentSnapshot | null }> {
    try {
      const collectionRef = collection(this.db, collectionName);
      const constraints: QueryConstraint[] = [];

      // Add filter constraints
      filters.forEach(filter => {
        constraints.push(where(filter.field, filter.operator, filter.value));
      });

      // Add sort constraint if provided
      if (sortField) {
        constraints.push(orderBy(sortField, sortDirection));
      } else {
        // Default sort by createdAt if no sort field provided
        constraints.push(orderBy('createdAt', sortDirection));
      }

      // Add cursor if we have a last document
      if (lastDoc) {
        constraints.push(startAfter(lastDoc));
      }

      // Add limit
      constraints.push(limit(pageSize));

      const q = query(collectionRef, ...constraints);
      const querySnapshot = await getDocs(q);

      const results: DocumentData[] = [];
      let lastVisible: DocumentSnapshot | null = null;

      if (!querySnapshot.empty) {
        querySnapshot.forEach((doc) => {
          results.push({ id: doc.id, ...doc.data() });
        });
        lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
      }

      return { docs: results, lastDoc: lastVisible };
    } catch (error) {
      console.error("Error in paginated query:", error);
      throw error;
    }
  }

}
