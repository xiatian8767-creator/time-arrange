package cn.xingke.timetable;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.*;

/** A single private temporary camera file, exposed only by explicit URI grant. */
public class PhotoProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri uri){return "image/jpeg";}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
        if(!"/capture.jpg".equals(uri.getPath()))throw new FileNotFoundException();
        return ParcelFileDescriptor.open(new File(getContext().getCacheDir(),"capture.jpg"),ParcelFileDescriptor.parseMode(mode));
    }
    @Override public Cursor query(Uri u,String[] p,String s,String[] a,String sort){return null;}
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
