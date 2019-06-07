package com.example.admin.bolar;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

public class BreakdownAdapter  extends RecyclerView.Adapter<BreakdownAdapter.ViewHolder> {

        // Provide a direct reference to each of the views within a data item
        // Used to cache the views within the item layout for fast access
        public class ViewHolder extends RecyclerView.ViewHolder {
            // Your holder should contain a member variable
            // for any view that will be set as you render a row
            public TextView addressText;
            public TextView sub1Text;
            public TextView sub2Text;
            public TextView data1Text;
            public TextView data2Text;

            // We also create a constructor that accepts the entire item row
            // and does the view lookups to find each subview
            public ViewHolder(View itemView) {
                // Stores the itemView in a public final member variable that can be used
                // to access the context from any ViewHolder instance.
                super(itemView);

                addressText = itemView.findViewById(R.id.address_textview);
                sub1Text = itemView.findViewById(R.id.subTitle1_textview);
                sub2Text = itemView.findViewById(R.id.subTitle2_textview);
                data1Text = itemView.findViewById(R.id.data1_textview);
                data2Text = itemView.findViewById(R.id.data2_textview);
            }
        }

        private List<BreakdownModel> items;
        private String factor;

        public BreakdownAdapter(List<BreakdownModel> items, String factor){
            this.items = items;
            this.factor = factor;
        }

        @Override
        public BreakdownAdapter.ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
            Context context = parent.getContext();
            LayoutInflater inflater = LayoutInflater.from(context);

            // Inflate the custom layout
            View itemView = inflater.inflate(R.layout.score_factor, parent, false);

            // Return a new holder instance
            ViewHolder viewHolder = new ViewHolder(itemView);
            return viewHolder;
        }

        @Override
        public void onBindViewHolder(BreakdownAdapter.ViewHolder viewHolder, int position) {
            // Get the data model based on position
            BreakdownModel item = items.get(position);

            TextView sub1 = viewHolder.sub1Text;
            TextView sub2 = viewHolder.sub2Text;

            if(factor.equals("Average_Duration_History")){
                sub1.setText("From");
                sub2.setText("To");
            }else if(factor.equals("Marks_History")){
                sub1.setText("Marks");
                sub2.setText("");
            }else if(factor.equals("Age_History")){
                sub1.setText("Months");
                sub2.setText("Years");
            }else if(factor.equals("Payment_History")){
                sub1.setText("On-Time Payments");
                sub2.setText("Missed Payments");
            }

            // Set item views based on your views and data model
            TextView address = viewHolder.addressText;
            address.setText(item.getAddress());

            TextView dataOne = viewHolder.data1Text;
            dataOne.setText(item.getData1());

            TextView dataTwo = viewHolder.data2Text;
            dataTwo.setText(item.getData2());
        }

        @Override
        public int getItemCount() {
            return items.size();
        }
    }
